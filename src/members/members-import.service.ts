import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ImportedMemberData {
  idNo: string;
  date: string;
  name: string;
  contactNumber: string;
  dob?: string;
  instagramHandle?: string;
  package: string;
  amount: number;
  received: number;
  pending: number;
  mop: string;
  salesPerson?: string;
  trainingType?: string;
  trainer?: string;
  memberType?: string;
  startingDate: string;
  expiryDate: string;
}

@Injectable()
export class MembersImportService {
  /**
   * Parse Excel file and extract member data
   */
  parseExcelFile(buffer: Buffer): ImportedMemberData[] {
    try {
      // Parse the Excel file
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // Get the first sheet
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const rawData: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (!rawData || rawData.length === 0) {
        throw new BadRequestException('Excel file is empty');
      }

      // Map Excel columns to our data structure
      const members: ImportedMemberData[] = rawData.map((row, index) => {
        try {
          return this.mapRowToMemberData(row, index + 2); // +2 because row 1 is headers, index starts at 0
        } catch (error) {
          throw new BadRequestException(
            `Error in row ${index + 2}: ${error.message}`,
          );
        }
      });

      return members;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to parse Excel file: ${error.message}`,
      );
    }
  }

  /**
   * Map Excel row to member data
   */
  private mapRowToMemberData(row: any, rowNumber: number): ImportedMemberData {
    // Extract package months (e.g., "1MONTH" -> 1, "7MONTH" -> 7, "6MONHT" -> 6)
    const packageStr = String(row['PACKAGE'] || row['package'] || '').toUpperCase();
    // Match patterns like 1MONTH, 7MONTH, or even typos like 6MONHT
    const monthsMatch = packageStr.match(/(\d+)\s*MON[TH]+/i);

    if (!monthsMatch) {
      throw new Error(`Invalid package format: ${packageStr}`);
    }

    const membershipMonths = parseInt(monthsMatch[1], 10);

    // Clean and validate required fields
    const idNo = this.cleanString(row['ID. NO'] || row['ID NO'] || row['idNo']);
    const name = this.cleanString(row['Client Name'] || row['name']);
    const contactNumber = this.cleanPhoneNumber(row['Phone Number'] || row['phone']);

    if (!idNo) throw new Error('ID. NO is required');
    if (!name) throw new Error('Client Name is required');
    if (!contactNumber) throw new Error('Phone Number is required');

    // Parse amounts
    const amount = this.parseAmount(
      row['AMOUNT'] || row['AMOUNT '] || row['amount'],
    );
    const received = this.parseAmount(
      row['RECEIVED'] || row['RECEIVED '] || row['received'],
    );

    // Calculate pending
    // If BALANCE column has "NIL" or is empty, calculate from amount - received
    // Otherwise use the BALANCE value
    const balAmount =
      row['BALANCE'] ||
      row['BALANCE '] ||
      row['BAL AMOUNT'] ||
      row['pending'];
    let pending: number;
    if (!balAmount || balAmount === 'NIL' || balAmount === '') {
      // Auto-calculate pending
      pending = amount - received;
    } else {
      pending = this.parseAmount(balAmount);
    }

    // Parse dates
    const date = this.parseDate(row['Date'] || row['date']);
    const startingDate = this.parseDate(row['STARTING DATE'] || row['startingDate']);
    const expiryDate = this.parseDate(row['EXPIRY DATE'] || row['expiryDate']);

    // Map MOP (Mode of Payment)
    const mopRaw = this.cleanString(row['MOP'] || row['mop'] || 'cash') || 'cash';
    let mop = mopRaw.toLowerCase();
    if (mop.includes('cash')) mop = 'cash';
    else if (mop.includes('scan') || mop.includes('upi')) mop = 'upi';
    else if (mop.includes('card')) mop = 'card';
    else if (mop.includes('bank')) mop = 'bank_transfer';

    return {
      idNo,
      date,
      name,
      contactNumber,
      dob: this.cleanString(row['DOB'] || row['dob']),
      instagramHandle: this.cleanString(row['INSTAGRAM'] || row['instagram']),
      package: packageStr,
      amount,
      received,
      pending,
      mop,
      salesPerson: this.cleanString(row['SALES'] || row['salesPerson']),
      trainingType: this.cleanString(row['TRAINING TYPE'] || row['trainingType']),
      trainer: this.cleanString(row['Trainer assigned'] || row['trainer']),
      memberType: this.cleanString(row['MEMBER TYPE'] || row['memberType']),
      startingDate,
      expiryDate,
    };
  }

  /**
   * Clean string values
   */
  private cleanString(value: any): string | undefined {
    if (!value || value === 'DD/MM/YY' || value === 'NIL') return undefined;
    const cleaned = String(value).trim();
    // Handle dashes (used for empty trainer fields)
    if (cleaned.match(/^-+$/)) return undefined;
    return cleaned;
  }

  /**
   * Clean phone number
   */
  private cleanPhoneNumber(value: any): string {
    if (!value) throw new Error('Phone number is required');

    // Remove all non-digits
    const cleaned = String(value).replace(/\D/g, '');

    // Ensure it's a valid length
    if (cleaned.length < 10) {
      throw new Error(`Invalid phone number: ${value}`);
    }

    return cleaned;
  }

  /**
   * Parse amount from various formats
   */
  private parseAmount(value: any): number {
    if (!value || value === 'NIL') return 0;

    const cleaned = String(value).replace(/[^0-9.]/g, '');
    const amount = parseFloat(cleaned);

    if (isNaN(amount)) {
      throw new Error(`Invalid amount: ${value}`);
    }

    return amount;
  }

  /**
   * Parse date from Excel or string format
   */
  private parseDate(value: any): string {
    if (!value) throw new Error('Date is required');

    // If it's already in YYYY-MM-DD format
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    // If it's a Date object or Excel serial number
    let date: Date;

    if (typeof value === 'number') {
      // Excel serial date
      const parsedDate = XLSX.SSF.parse_date_code(value);
      date = new Date(parsedDate.y, parsedDate.m - 1, parsedDate.d);
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string') {
      // Try parsing various date formats
      // Format: 8/1/2025 or 08/01/2025 (M/D/YYYY or MM/DD/YYYY)
      const parts = value.split('/');
      if (parts.length === 3) {
        const month = parseInt(parts[0], 10);
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        date = new Date(year, month - 1, day);
      } else {
        date = new Date(value);
      }
    } else {
      throw new Error(`Invalid date format: ${value}`);
    }

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${value}`);
    }

    // Return in YYYY-MM-DD format
    return date.toISOString().split('T')[0];
  }

  /**
   * Extract membership months from package string
   */
  extractMonthsFromPackage(packageStr: string): number {
    const match = packageStr.match(/(\d+)\s*MON[TH]+/i);
    return match ? parseInt(match[1], 10) : 1;
  }
}
