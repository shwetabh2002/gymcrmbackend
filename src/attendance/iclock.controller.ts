import {
  Controller,
  Post,
  All,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';

/**
 * Controller for iclock protocol endpoints
 * Many ESSL/ZKTeco devices use iclock protocol and push to these paths
 */
@Controller('iclock')
export class IclockController {
  private readonly logger = new Logger(IclockController.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * Standard iclock endpoint for attendance data
   * POST /iclock/cdata
   */
  @Post('cdata')
  @HttpCode(HttpStatus.OK)
  async receiveIclockData(@Body() data: any, @Req() req: any) {
    this.logger.log(`📥 iclock/cdata data received from IP: ${req.ip}`);
    this.logger.debug(`iclock Data: ${JSON.stringify(data)}`);

    return this.attendanceService.processPushData(data, req.ip);
  }

  /**
   * Device info endpoint
   * GET/POST /iclock/getrequest
   */
  @All('getrequest')
  @HttpCode(HttpStatus.OK)
  async getRequest(@Req() req: any) {
    this.logger.log(`📥 iclock/getrequest from IP: ${req.ip}`);
    // Return empty response - device just checking connection
    return 'OK';
  }

  /**
   * Device command endpoint
   * GET/POST /iclock/devicecmd
   */
  @All('devicecmd')
  @HttpCode(HttpStatus.OK)
  async deviceCmd(@Req() req: any) {
    this.logger.log(`📥 iclock/devicecmd from IP: ${req.ip}`);
    // Return empty response
    return 'OK';
  }
}
