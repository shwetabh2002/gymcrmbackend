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
} from '@nestjs/common';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { RegisterMemberDto } from './dto/register-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('members')
@UseGuards(JwtAuthGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateMemberDto) {
    return this.membersService.create(createDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.membersService.findAll();
  }

  // === New Simplified Flow Endpoints (must be before :id routes) ===

  /**
   * Register a new member with membership and payment in one call
   * POST /members/register
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterMemberDto) {
    return this.membersService.register(registerDto);
  }

  /**
   * Get all registered members (simplified flow)
   * GET /members/register
   */
  @Get('register')
  @HttpCode(HttpStatus.OK)
  async findAllRegistered() {
    return this.membersService.findAllRegistered();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string) {
    return this.membersService.findById(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() updateDto: UpdateMemberDto) {
    return this.membersService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.membersService.delete(id);
    return { message: 'Member deleted successfully' };
  }

  /**
   * Get all payments for a specific member
   * GET /members/:id/payments
   */
  @Get(':id/payments')
  @HttpCode(HttpStatus.OK)
  async getMemberPayments(@Param('id') id: string) {
    return this.membersService.getMemberPayments(id);
  }
}
