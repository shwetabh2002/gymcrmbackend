# 🏋️ Gym Management System
Project Functional Documentation

## 1. Project Overview
The Gym Management System is a web-based platform designed to help gym administrators efficiently manage members, subscriptions, payments, and billing through a centralized dashboard.

The system will allow the admin to:
- Add and manage members
- Create and manage subscription plans
- Track subscription validity and status
- Maintain payment records
- Generate invoices
- View real-time dashboard insights

This system will digitize gym operations and eliminate manual tracking.

## 2. User Role

### Admin
The system will be operated by an Admin who will have full access to:
- Member management
- Subscription management
- Payment tracking
- Invoice generation
- Dashboard monitoring

## 3. Core Features

### 3.1 Member Management

#### Add New Member
The Admin can create a new member profile by entering:
- Full Name
- Phone Number
- Email
- Address (if required)
- Emergency Contact (if required)
- Subscription Plan
- Subscription Start Date
- Pay Details

Upon creation, the selected subscription will be assigned to the member automatically.

#### Edit Member
The Admin can:
- Update member details
- Renew subscription
- Change subscription plan
- Add new payments

#### View Member Details
Each member profile will display:
- Personal details
- Assigned subscription plan
- Subscription start date
- Subscription expiry date
- Current subscription status
- Payment history
- Generated invoices

### 3.2 Subscription Plan Management
The Admin can create and manage different subscription plans.

#### Create Subscription Plan
Fields include:
- Plan Name
- Duration
- Price
- Description
- Plan Status (Active / Inactive)

#### Manage Subscription Plans
The Admin can:
- Update plan details
- Modify pricing
- Activate or deactivate plans

### 3.3 Payment Management
For each member, the Admin can:
- Record payment amount
- Select payment mode (Cash / UPI / Card / Bank Transfer)
- Add transaction reference (if applicable)
- Select payment date

The system will maintain a structured payment history for every member.

### 3.4 Invoice Generation (PDF)
The system will support automated invoice generation for each payment made by a member.

#### Invoice Features:
- Unique Invoice Number
- Member Details
- Subscription Plan Details
- Payment Amount
- Payment Date
- Payment Mode
- Tax details (if applicable)
- Gym Details (Name, Address, Contact)

#### Invoice Capabilities:
- Generate invoice automatically upon payment entry
- Download invoice as PDF
- Re-download previous invoices from member profile
- Maintain invoice history per member

Invoices will be professionally formatted and suitable for printing or digital sharing.

### 3.5 Dashboard & Reporting
The dashboard will provide a complete overview of gym operations.

#### Dashboard Categories
- Active Members
- Members with subscriptions ending soon
- Expired Members
- All Members

#### Dashboard Metrics
- Total Members
- Active Subscriptions
- Expiring Soon
- Expired
- Total Revenue
- Revenue (selected time period)

#### Filtering & Search
Admin can filter members by:
- Subscription status
- Subscription plan
- Date range

## 4. Data Structure (High-Level)
The system will maintain structured records for:
- Admin
- Members
- Subscription Plans
- Member Subscriptions
- Payments
- Invoices

All records will be securely stored and easily retrievable through the dashboard.

## 5. Security
- Secure Admin login
- Encrypted password storage
- Role-based access
- Data validation and protection

## 6. Expected Outcome
This system will provide:
- Organized member records
- Clear subscription tracking
- Structured payment history
- Automated invoice generation
- Real-time dashboard insights
- Improved operational efficiency
