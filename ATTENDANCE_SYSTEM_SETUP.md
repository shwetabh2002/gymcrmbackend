# ESSL K30 Pro Attendance System Integration Guide

Complete guide to integrate ESSL K30 Pro fingerprint attendance machine with your Gym CRM system.

---

## Table of Contents
1. [Overview](#overview)
2. [Physical Device Setup](#physical-device-setup)
3. [Backend Configuration](#backend-configuration)
4. [Employee Setup](#employee-setup)
5. [Testing](#testing)
6. [API Endpoints](#api-endpoints)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### What's Built
- **Attendance Schema**: Database to store punch records
- **Push Endpoint**: Receives real-time data from K30 Pro device
- **Attendance APIs**: View and manage attendance records
- **Manual Entry**: Admin can manually add/edit attendance
- **Reports**: Daily, monthly attendance with statistics

### How It Works
```
Employee punches fingerprint on K30 Pro (at gym)
         ↓
K30 Pro sends data via WiFi → https://crmdalyfstylefitness.in/attendance/push
         ↓
Backend processes and stores in MongoDB
         ↓
Attendance visible in CRM frontend
```

---

## Physical Device Setup

### Step 1: Power On Device
1. Connect 12V power adapter to K30 Pro
2. Device screen will light up
3. Default admin password: **0** or **123456**

### Step 2: Connect to WiFi
1. On device screen, press **MENU**
2. Enter admin password (try 0 or 123456)
3. Navigate to: **Comm** → **WiFi**
4. Select your gym's WiFi network
5. Enter WiFi password
6. Device will show an **IP address** (e.g., 192.168.1.100)
7. **Write down this IP address** - you may need it for troubleshooting

### Step 3: Configure Cloud Server Push
1. On device: **MENU** → **Comm** → **Cloud Server**
2. Configure these settings:
   ```
   Server Address: crmdalyfstylefitness.in
   Port: 443
   Path: /attendance/push
   Push Interval: 1 (minute)
   Enable Push: YES
   ```
3. Save settings
4. Device will start pushing data automatically

### Alternative Configuration (if above doesn't work)
Some devices may require full URL:
```
Server URL: https://crmdalyfstylefitness.in/attendance/push
Push Method: POST
Content Type: application/json
```

---

## Backend Configuration

### What's Already Done ✅
- Attendance module created
- Database schema configured
- Push endpoint available at: `https://crmdalyfstylefitness.in/attendance/push`
- APIs for viewing/managing attendance

### Deploy to EC2
```bash
# On your EC2 instance
cd /home/ec2-user/gymcrmbackend

# Pull latest code
git pull

# Install dependencies
npm install

# Build
npm run build

# Restart PM2
pm2 restart backendgym

# Check logs
pm2 logs backendgym --lines 50
```

You should see these routes in the logs:
```
[RouterExplorer] Mapped {/attendance/push, POST} route
[RouterExplorer] Mapped {/attendance, GET} route
[RouterExplorer] Mapped {/attendance/today, GET} route
[RouterExplorer] Mapped {/attendance/statistics, GET} route
[RouterExplorer] Mapped {/attendance/employee/:employeeId, GET} route
[RouterExplorer] Mapped {/attendance/manual, POST} route
[RouterExplorer] Mapped {/attendance/:id, DELETE} route
```

---

## Employee Setup

### Step 1: Register Employee in K30 Pro Device

**On the K30 Pro device:**
1. Press **MENU** → **User Mgt** → **New User**
2. Enter User ID (e.g., **1**, **2**, **3**...)
   - This is important! Remember this number for each employee
3. Enter employee name
4. Place finger on scanner 3 times to register fingerprint
5. Save user

**Repeat for all employees** - each gets a unique User ID (1, 2, 3, etc.)

### Step 2: Link Employee in CRM System

**In your CRM frontend:**
1. Go to **Employees** section
2. Edit each employee
3. Add the **Device User ID** field (the number you assigned in K30 Pro)
   - Example: If you registered "John Doe" as User ID "1" in K30 Pro, enter "1" in the Device User ID field
4. Save

**This mapping is crucial!** The system uses this to link fingerprint punches to the correct employee.

---

## Testing

### Test 1: Manual Test Push
Test the endpoint manually to ensure it's receiving data:

```bash
curl -X POST https://crmdalyfstylefitness.in/attendance/push \
  -H "Content-Type: application/json" \
  -d '{
    "UserID": "1",
    "DateTime": "2026-04-06 09:30:00",
    "SN": "test-device"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Attendance recorded successfully",
  "data": { ... }
}
```

### Test 2: Actual Fingerprint Punch
1. Have an employee punch their fingerprint on K30 Pro
2. Wait 1-2 minutes (based on push interval)
3. Check backend logs:
   ```bash
   pm2 logs backendgym --lines 100 | grep "Attendance"
   ```
4. You should see:
   ```
   📥 Received push data from device
   ✅ Attendance recorded for [Employee Name] on 2026-04-06
   ```

### Test 3: View Attendance
Get today's attendance via API:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://crmdalyfstylefitness.in/attendance/today
```

---

## API Endpoints

### 1. Push Endpoint (for K30 Pro device)
```
POST /attendance/push
Body: {
  "UserID": "1",
  "DateTime": "2026-04-06 09:30:00",
  "SN": "device-serial"
}
```

### 2. Get All Attendance (with filters)
```
GET /attendance?employeeId=xxx&month=2026-04
Headers: Authorization: Bearer {token}
```

### 3. Get Today's Attendance
```
GET /attendance/today
Headers: Authorization: Bearer {token}
```

### 4. Get Attendance Statistics
```
GET /attendance/statistics?month=2026-04
Headers: Authorization: Bearer {token}

Response:
{
  "totalRecords": 150,
  "present": 120,
  "absent": 10,
  "late": 15,
  "halfDay": 5,
  "leave": 0,
  "averageWorkingHours": 8.5
}
```

### 5. Get Employee Attendance
```
GET /attendance/employee/{employeeId}?month=2026-04
Headers: Authorization: Bearer {token}
```

### 6. Manual Attendance Entry
```
POST /attendance/manual
Headers: Authorization: Bearer {token}
Body: {
  "employeeId": "xxx",
  "date": "2026-04-06",
  "checkInTime": "2026-04-06T09:00:00Z",
  "checkOutTime": "2026-04-06T18:00:00Z",
  "status": "Present",
  "remarks": "Manual entry"
}
```

### 7. Delete Attendance Record
```
DELETE /attendance/{id}
Headers: Authorization: Bearer {token}
```

---

## Attendance Data Structure

Each attendance record contains:
```typescript
{
  employeeId: "ObjectId",
  employeeName: "John Doe",
  deviceUserId: "1",
  date: "2026-04-06",
  checkInTime: "2026-04-06T09:15:00Z",
  checkOutTime: "2026-04-06T18:30:00Z",
  allPunches: [
    "2026-04-06T09:15:00Z",
    "2026-04-06T12:00:00Z",  // Lunch
    "2026-04-06T13:00:00Z",  // Back from lunch
    "2026-04-06T18:30:00Z"
  ],
  status: "Late",  // Present | Absent | Late | Half Day | Leave
  workingHours: 9.25,
  isLate: true,
  remarks: "Optional notes",
  deviceIp: "192.168.1.100",
  deviceSerialNumber: "K30-12345"
}
```

### Status Logic
- **Present**: Checked in on time (before 9:15 AM)
- **Late**: Checked in after 9:15 AM
- **Half Day**: Less than 4 hours worked
- **Absent**: No punch record
- **Leave**: Manually marked

### Working Hours Calculation
```
workingHours = (checkOutTime - checkInTime) in hours
```

---

## Troubleshooting

### Problem 1: Device Not Sending Data

**Symptoms:** No data appearing in backend logs

**Solutions:**
1. Check WiFi connection on device
   - Menu → Comm → WiFi → ensure connected
2. Ping the server from device IP
3. Check device logs (if accessible)
4. Verify cloud server settings:
   - Server address correct
   - Port correct (443 for HTTPS, 80 for HTTP)
   - Push enabled = YES
5. Check firewall on EC2 - port 443 should be open

### Problem 2: "Employee not found" Error

**Symptoms:** Backend logs show "No employee found for device user ID: X"

**Solutions:**
1. Ensure employee has `deviceUserId` field set in database
2. Device User ID must match exactly
   - If device sends "1", employee must have deviceUserId = "1"
   - No spaces, case-sensitive
3. Check MongoDB:
   ```javascript
   db.employees.find({ deviceUserId: "1" })
   ```

### Problem 3: Wrong Employee Getting Attendance

**Cause:** Device User ID mapping is incorrect

**Solution:**
1. Check which User ID is assigned to employee in K30 Pro
2. Update the employee's `deviceUserId` field in CRM to match

### Problem 4: Attendance Not Saving

**Check:**
1. MongoDB connection is active
2. Backend logs for errors:
   ```bash
   pm2 logs backendgym --lines 200 | grep -i error
   ```
3. Database write permissions

### Problem 5: Late Status Not Correct

**Default shift start time is 9:00 AM** (late grace period: 15 minutes)

To change, edit `/backendgym/src/attendance/attendance.service.ts`:
```typescript
const shiftStartHour = 10;  // Change to 10 AM
const checkInMinute = punchDateTime.getMinutes();

if (checkInHour > shiftStartHour ||
    (checkInHour === shiftStartHour && checkInMinute > 30)) { // 30 min grace
  attendance.isLate = true;
}
```

---

## Device Data Format Examples

Different K30 Pro firmware versions may send data in different formats:

### Format 1 (Common):
```json
{
  "SN": "K30-12345",
  "UserID": "1",
  "DateTime": "2026-04-06 09:30:00",
  "State": 0
}
```

### Format 2 (Alternative):
```json
{
  "deviceSerialNumber": "K30-12345",
  "userId": "1",
  "punchTime": "2026-04-06T09:30:00Z",
  "punchType": 0
}
```

Our backend handles both formats automatically.

---

## Next Steps

### 1. Build Frontend UI
Create pages in your CRM to:
- View today's attendance (who's present/absent)
- View monthly attendance reports
- Mark manual attendance
- Export to Excel

### 2. Advanced Features (Optional)
- SMS/Email alerts for late arrivals
- Overtime calculation
- Leave management integration
- Shift scheduling
- Multiple device support

### 3. Reports
- Daily attendance summary
- Monthly attendance sheet
- Late arrival report
- Employee-wise attendance percentage
- Absent employee alerts

---

## Security Notes

1. The `/attendance/push` endpoint is **public** (no JWT required) because the K30 Pro device can't send auth tokens
2. However, it validates:
   - Employee must exist with matching deviceUserId
   - Data format must be valid
   - IP address is logged for audit

3. All other attendance endpoints require JWT authentication

---

## Support

If you encounter issues:

1. Check PM2 logs: `pm2 logs backendgym`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Check device manual for exact cloud server configuration format
4. Contact ESSL support if device connectivity issues persist

---

## Summary Checklist

- [ ] Device powered on and connected to WiFi
- [ ] Cloud server configured in device (server address, port, path)
- [ ] Push enabled in device settings
- [ ] Backend deployed to EC2
- [ ] Employees registered in K30 Pro device (each with unique User ID)
- [ ] Employees updated in CRM with deviceUserId field
- [ ] Test punch performed successfully
- [ ] Attendance data visible in backend logs
- [ ] APIs tested and working

Once all checkmarks complete, your attendance system is live! 🎉
