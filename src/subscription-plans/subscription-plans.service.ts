import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
} from './schemas/subscription-plan.schema';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

@Injectable()
export class SubscriptionPlansService {
  constructor(
    @InjectModel(SubscriptionPlan.name)
    private subscriptionPlanModel: Model<SubscriptionPlanDocument>,
  ) {}

  async create(
    companyId: string,
    createDto: CreateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanDocument> {
    const plan = new this.subscriptionPlanModel({
      ...createDto,
      companyId,
    });
    return plan.save();
  }

  async findAll(companyId: string): Promise<SubscriptionPlanDocument[]> {
    return this.subscriptionPlanModel.find({ companyId }).exec();
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<SubscriptionPlanDocument> {
    const plan = await this.subscriptionPlanModel
      .findOne({ _id: id, companyId })
      .exec();
    if (!plan) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }
    return plan;
  }

  async update(
    companyId: string,
    id: string,
    updateDto: UpdateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanDocument> {
    const { companyId: _ignore, ...safeUpdate } = updateDto as any;
    const plan = await this.subscriptionPlanModel
      .findOneAndUpdate({ _id: id, companyId }, safeUpdate, {
        returnDocument: 'after',
      })
      .exec();

    if (!plan) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }

    return plan;
  }

  async delete(companyId: string, id: string): Promise<void> {
    const result = await this.subscriptionPlanModel
      .findOneAndDelete({ _id: id, companyId })
      .exec();
    if (!result) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }
  }
}
