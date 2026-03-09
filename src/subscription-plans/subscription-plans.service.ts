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
    createDto: CreateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanDocument> {
    const plan = new this.subscriptionPlanModel(createDto);
    return plan.save();
  }

  async findAll(): Promise<SubscriptionPlanDocument[]> {
    return this.subscriptionPlanModel.find().exec();
  }

  async findById(id: string): Promise<SubscriptionPlanDocument> {
    const plan = await this.subscriptionPlanModel.findById(id).exec();
    if (!plan) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }
    return plan;
  }

  async update(
    id: string,
    updateDto: UpdateSubscriptionPlanDto,
  ): Promise<SubscriptionPlanDocument> {
    const plan = await this.subscriptionPlanModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .exec();

    if (!plan) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }

    return plan;
  }

  async delete(id: string): Promise<void> {
    const result = await this.subscriptionPlanModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }
  }
}
