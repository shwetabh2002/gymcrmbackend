import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InquiryStatus,
  PlatformPlanInquiry,
  PlatformPlanInquiryDocument,
} from './schemas/platform-plan-inquiry.schema';
import { Company, CompanyDocument } from '../companies/schemas/company.schema';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';

export type SubmitInquiryInput = {
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  branchCount: number;
  approxMembers?: number;
  needs?: string[];
  currentSoftware?: string;
  message?: string;
};

@Injectable()
export class PlatformPlanInquiryService {
  constructor(
    @InjectModel(PlatformPlanInquiry.name)
    private inquiryModel: Model<PlatformPlanInquiryDocument>,
    @InjectModel(Company.name)
    private companyModel: Model<CompanyDocument>,
    private activityLogs: ActivityLogsService,
  ) {}

  async submit(
    companyId: string,
    userId: string | undefined,
    input: SubmitInquiryInput,
    actorName?: string,
  ) {
    const name = (input.contactName || '').trim();
    const phone = (input.contactPhone || '').trim();
    if (!name) throw new BadRequestException('contactName is required');
    if (!phone) throw new BadRequestException('contactPhone is required');
    const branches = Number(input.branchCount);
    if (!Number.isFinite(branches) || branches < 1) {
      throw new BadRequestException('branchCount must be at least 1');
    }

    const company = await this.companyModel.findById(companyId).lean().exec();
    if (!company) throw new NotFoundException('Company not found');

    const doc = await this.inquiryModel.create({
      companyId: new Types.ObjectId(companyId),
      companyName: (company as any).name || 'Gym',
      contactName: name,
      contactPhone: phone,
      contactEmail: input.contactEmail?.trim() || null,
      branchCount: Math.round(branches),
      approxMembers:
        input.approxMembers != null && Number.isFinite(Number(input.approxMembers))
          ? Math.max(0, Math.round(Number(input.approxMembers)))
          : null,
      needs: (input.needs || [])
        .map((n) => String(n).trim())
        .filter(Boolean)
        .slice(0, 12),
      currentSoftware: input.currentSoftware?.trim() || null,
      message: input.message?.trim()?.slice(0, 2000) || null,
      status: 'NEW',
      submittedByUserId: userId ? new Types.ObjectId(userId) : null,
    });

    if (userId) {
      await this.activityLogs.log({
        companyId,
        actor: { userId, name: actorName || name },
        action: 'CUSTOM_INQUIRY_SUBMITTED',
        entityType: 'platform_plan_inquiry',
        entityId: String(doc._id),
        summary: `Custom plan inquiry from ${name} (${phone})`,
        metadata: {
          branchCount: doc.branchCount,
          needs: doc.needs,
        },
      });
    }

    return this.toClient(doc.toObject());
  }

  async listForAdmin(status?: string) {
    const filter: Record<string, unknown> = {};
    if (status && status !== 'ALL') {
      filter.status = status.toUpperCase();
    }
    const rows = await this.inquiryModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    return rows.map((r) => this.toClient(r));
  }

  async updateStatus(
    id: string,
    status: InquiryStatus,
    adminNotes?: string,
    actor?: ActivityActor,
  ) {
    if (!['NEW', 'CONTACTED', 'CLOSED'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const existing = await this.inquiryModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Inquiry not found');

    existing.status = status;
    if (status === 'CONTACTED') existing.contactedAt = new Date();
    if (adminNotes !== undefined) {
      existing.adminNotes = adminNotes?.trim() || null;
    }
    await existing.save();

    if (actor) {
      await this.activityLogs.log({
        companyId: String(existing.companyId),
        actor,
        action: 'CUSTOM_INQUIRY_UPDATED',
        entityType: 'platform_plan_inquiry',
        entityId: String(existing._id),
        summary: `Custom inquiry marked ${status}`,
        metadata: { status, adminNotes: existing.adminNotes },
      });
    }

    return this.toClient(existing.toObject());
  }

  private toClient(doc: any) {
    return {
      id: String(doc._id),
      companyId: String(doc.companyId),
      companyName: doc.companyName,
      contactName: doc.contactName,
      contactPhone: doc.contactPhone,
      contactEmail: doc.contactEmail ?? null,
      branchCount: doc.branchCount,
      approxMembers: doc.approxMembers ?? null,
      needs: doc.needs || [],
      currentSoftware: doc.currentSoftware ?? null,
      message: doc.message ?? null,
      status: doc.status,
      adminNotes: doc.adminNotes ?? null,
      contactedAt: doc.contactedAt ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
