import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { RegisterMemberDto } from './dto/register-member.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsListQueryDto } from './dto/payments-list-query.dto';
import { MembersListQueryDto } from './dto/members-list-query.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ParseObjectIdPipe } from '@nestjs/mongoose';

@Controller('members')
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

  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list(@Query() query: MembersListQueryDto) {
    return this.membersService.getMembersList(query);
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
   * Get all registered members (simplified flow) with pagination and search
   * GET /members/register?page=1&limit=10&search=john
   */
  @Get('register')
  @HttpCode(HttpStatus.OK)
  async findAllRegistered(@Query() query: PaginationQueryDto) {
    return this.membersService.findAllRegistered(query);
  }

  /**
   * Get all payments from simplified flow with pagination and search
   * GET /members/payments?page=1&limit=10&search=john
   */
  @Get('payments')
  @HttpCode(HttpStatus.OK)
  async getAllPayments(@Query() query: PaymentsListQueryDto) {
    return this.membersService.getAllPayments(query);
  }

  /**
   * Create a new payment for an existing member
   * POST /members/payments
   */
  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  async createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.membersService.createPayment(createPaymentDto);
  }

  /**
   * Import members from Excel file
   * POST /members/import
   */
  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async importMembers(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!file.originalname.match(/\.(xlsx|xls)$/)) {
      throw new BadRequestException('Only Excel files (.xlsx, .xls) are allowed');
    }

    return this.membersService.importFromExcel(file.buffer);
  }

  /** Dynamic :id routes last. */
  @Get(':id/payments')
  @HttpCode(HttpStatus.OK)
  async getMemberPayments(@Param('id', ParseObjectIdPipe) id: string) {
    return this.membersService.getMemberPayments(id);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.membersService.findById(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() updateDto: UpdateMemberDto,
  ) {
    return this.membersService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id', ParseObjectIdPipe) id: string) {
    await this.membersService.delete(id);
    return { message: 'Member deleted successfully' };
  }
}
