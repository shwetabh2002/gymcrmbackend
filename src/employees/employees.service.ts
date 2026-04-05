import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Employee, EmployeeDocument } from './schemas/employee.schema';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(Employee.name)
    private employeeModel: Model<EmployeeDocument>,
    private configService: ConfigService,
  ) {}

  // Auth methods
  verifyPassword(password: string): boolean {
    const correctPassword = this.configService.get<string>('EMPLOYEE_SECTION_PASSWORD');
    if (!correctPassword) {
      throw new Error('EMPLOYEE_SECTION_PASSWORD not configured in environment');
    }
    return password === correctPassword;
  }

  // CRUD methods
  async create(createDto: CreateEmployeeDto): Promise<EmployeeDocument> {
    // Check if email already exists
    const existing = await this.employeeModel.findOne({ email: createDto.email }).exec();
    if (existing) {
      throw new ConflictException(`Employee with email ${createDto.email} already exists`);
    }

    // Auto-generate Employee ID
    const employeeId = await this.generateEmployeeId();

    const employee = new this.employeeModel({
      ...createDto,
      employeeId,
      joiningDate: new Date(createDto.joiningDate),
      ...(createDto.dob && { dob: new Date(createDto.dob) }),
      ...(createDto.anniversaryDate && { anniversaryDate: new Date(createDto.anniversaryDate) }),
    });

    return employee.save();
  }

  /**
   * Generate next Employee ID (EMP-001, EMP-002, etc.)
   */
  private async generateEmployeeId(): Promise<string> {
    // Find the latest employee by sorting employeeId in descending order
    const lastEmployee = await this.employeeModel
      .findOne()
      .sort({ employeeId: -1 })
      .exec();

    if (!lastEmployee || !lastEmployee.employeeId) {
      return 'EMP-001';
    }

    // Extract number from last ID (e.g., "EMP-005" -> 5)
    const match = lastEmployee.employeeId.match(/EMP-(\d+)/);
    if (!match) {
      return 'EMP-001';
    }

    const lastNumber = parseInt(match[1], 10);
    const nextNumber = lastNumber + 1;

    // Pad with zeros (e.g., 6 -> "006")
    return `EMP-${String(nextNumber).padStart(3, '0')}`;
  }

  async findAll(): Promise<EmployeeDocument[]> {
    return this.employeeModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<EmployeeDocument> {
    const employee = await this.employeeModel.findById(id).exec();
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return employee;
  }

  async update(id: string, updateDto: UpdateEmployeeDto): Promise<EmployeeDocument> {
    // If email is being updated, check for conflicts
    if (updateDto.email) {
      const existing = await this.employeeModel
        .findOne({ email: updateDto.email, _id: { $ne: id } })
        .exec();

      if (existing) {
        throw new ConflictException(`Email ${updateDto.email} is already in use`);
      }
    }

    const employee = await this.employeeModel
      .findByIdAndUpdate(
        id,
        {
          ...updateDto,
          ...(updateDto.joiningDate && { joiningDate: new Date(updateDto.joiningDate) }),
          ...(updateDto.dob && { dob: new Date(updateDto.dob) }),
          ...(updateDto.anniversaryDate && { anniversaryDate: new Date(updateDto.anniversaryDate) }),
        },
        { new: true }
      )
      .exec();

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async delete(id: string): Promise<void> {
    const result = await this.employeeModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
  }

  /**
   * Find employee by device user ID (for biometric integration)
   */
  async findByDeviceUserId(deviceUserId: string): Promise<EmployeeDocument | null> {
    return this.employeeModel.findOne({ deviceUserId }).exec();
  }

  /**
   * Get employees with birthdays tomorrow
   */
  async getUpcomingBirthdays(): Promise<EmployeeDocument[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowMonth = tomorrow.getMonth() + 1; // 1-12
    const tomorrowDay = tomorrow.getDate();

    const allEmployees = await this.employeeModel
      .find({ status: 'ACTIVE', dob: { $exists: true, $ne: null } })
      .exec();

    return allEmployees.filter(emp => {
      if (!emp.dob) return false;
      const dobDate = new Date(emp.dob);
      const empMonth = dobDate.getMonth() + 1;
      const empDay = dobDate.getDate();
      return empMonth === tomorrowMonth && empDay === tomorrowDay;
    });
  }

  /**
   * Get employees with anniversaries tomorrow
   */
  async getUpcomingAnniversaries(): Promise<EmployeeDocument[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowMonth = tomorrow.getMonth() + 1; // 1-12
    const tomorrowDay = tomorrow.getDate();

    const allEmployees = await this.employeeModel
      .find({
        status: 'ACTIVE',
        isMarried: true,
        anniversaryDate: { $exists: true, $ne: null }
      })
      .exec();

    return allEmployees.filter(emp => {
      if (!emp.anniversaryDate) return false;
      const annDate = new Date(emp.anniversaryDate);
      const annMonth = annDate.getMonth() + 1;
      const annDay = annDate.getDate();
      return annMonth === tomorrowMonth && annDay === tomorrowDay;
    });
  }
}
