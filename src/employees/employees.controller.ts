import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UnlockEmployeeSectionDto } from './dto/unlock-employee-section.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EmployeeAccessGuard } from './guards/employee-access.guard';

@Controller('employees')
@UseGuards(JwtAuthGuard) // Must be logged in as admin
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // ===== Auth Endpoints (No EmployeeAccessGuard) =====

  /**
   * Verify employee section password
   * POST /employees/auth/verify
   */
  @Post('auth/verify')
  @HttpCode(HttpStatus.OK)
  verifyPassword(@Body() dto: UnlockEmployeeSectionDto) {
    const isValid = this.employeesService.verifyPassword(dto.password);

    if (!isValid) {
      throw new UnauthorizedException('Invalid password');
    }

    return {
      success: true,
      message: 'Password verified successfully',
    };
  }

  // ===== CRUD Endpoints (Protected by EmployeeAccessGuard) =====

  /**
   * Create a new employee
   * POST /employees
   */
  @Post()
  @UseGuards(EmployeeAccessGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateEmployeeDto) {
    return this.employeesService.create(createDto);
  }

  /**
   * Get all employees
   * GET /employees
   */
  @Get()
  @UseGuards(EmployeeAccessGuard)
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.employeesService.findAll();
  }

  /**
   * Get employee by ID
   * GET /employees/:id
   */
  @Get(':id')
  @UseGuards(EmployeeAccessGuard)
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string) {
    return this.employeesService.findById(id);
  }

  /**
   * Update employee
   * PUT /employees/:id
   */
  @Put(':id')
  @UseGuards(EmployeeAccessGuard)
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() updateDto: UpdateEmployeeDto) {
    return this.employeesService.update(id, updateDto);
  }

  /**
   * Delete employee
   * DELETE /employees/:id
   */
  @Delete(':id')
  @UseGuards(EmployeeAccessGuard)
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.employeesService.delete(id);
    return { message: 'Employee deleted successfully' };
  }
}
