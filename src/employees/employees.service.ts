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

    const employee = new this.employeeModel({
      ...createDto,
      joiningDate: new Date(createDto.joiningDate),
    });

    return employee.save();
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
}
