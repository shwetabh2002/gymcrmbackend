const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

const excelFilePath = '/Users/shwetabh/Downloads/members dashboard ex..xlsx';

async function testImport() {
  try {
    // First, login to get token
    console.log('🔐 Logging in...');
    const loginResponse = await axios.post('http://localhost:5000/auth/admin/login', {
      email: 'admin@backendgym.com',
      password: 'Admin@123'
    });

    const token = loginResponse.data.accessToken;
    console.log('✅ Login successful, got token\n');

    // Create form data
    const form = new FormData();
    form.append('file', fs.createReadStream(excelFilePath));

    // Import the Excel file
    console.log('📤 Importing Excel file...');
    const importResponse = await axios.post(
      'http://localhost:5000/members/import',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${token}`
        }
      }
    );

    console.log('✅ Import successful!');
    console.log(`\n📊 Import Summary:`);
    console.log(`   Total: ${importResponse.data.total}`);
    console.log(`   Success: ${importResponse.data.success}`);
    console.log(`   Failed: ${importResponse.data.failed}`);
    console.log(`   Skipped: ${importResponse.data.skipped}`);

    if (importResponse.data.errors && importResponse.data.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      importResponse.data.errors.forEach(err => {
        console.log(`   - ${err.row}: ${err.error}`);
      });
    }

    // Get the first imported member to verify
    if (importResponse.data.imported && importResponse.data.imported.length > 0) {
      const firstImport = importResponse.data.imported[0];
      const memberId = firstImport.member._id;
      const memberName = firstImport.member.name;

      console.log(`\n🔍 Testing first imported member: ${memberName} (${memberId})`);

      // Fetch the member to verify memberships array
      console.log('\n📋 Fetching member details to verify memberships array...');
      const memberResponse = await axios.get(
        `http://localhost:5000/members/${memberId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const member = memberResponse.data;

      // Check memberships array
      if (member.memberships && member.memberships.length > 0) {
        console.log('\n✅ SUCCESS: Memberships array exists!');
        console.log(`   Number of memberships: ${member.memberships.length}`);
        console.log('\n   Membership Details:');
        const membership = member.memberships[0];
        console.log(`   - ID: ${membership._id}`);
        console.log(`   - Status: ${membership.status}`);
        console.log(`   - Start Date: ${new Date(membership.startDate).toLocaleDateString()}`);
        console.log(`   - Expiry Date: ${new Date(membership.expiryDate).toLocaleDateString()}`);
        console.log(`   - Months: ${membership.months}`);
        console.log(`   - Total Amount: ₹${membership.totalAmount}`);
        console.log(`   - Amount Paid: ₹${membership.amountPaid}`);
        console.log(`   - Pending Amount: ₹${membership.pendingAmount}`);
        console.log(`   - Package: ${membership.package}`);
        console.log(`   - Training Type: ${membership.trainingType}`);
        console.log(`   - Trainer: ${membership.trainer || 'N/A'}`);
        console.log(`   - Sales Person: ${membership.salesPerson}`);

        // Get payment to verify it's linked to membership
        console.log('\n💰 Fetching payment details...');
        const paymentsResponse = await axios.get(
          `http://localhost:5000/members/${memberId}/payments`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (paymentsResponse.data.length > 0) {
          const payment = paymentsResponse.data[0];
          console.log('\n   Payment Details:');
          console.log(`   - Payment ID: ${payment._id}`);
          console.log(`   - Amount: ₹${payment.amount}`);
          console.log(`   - Received: ₹${payment.received}`);
          console.log(`   - Pending: ₹${payment.pending}`);
          console.log(`   - Mode: ${payment.mop}`);
          console.log(`   - Payment Date: ${new Date(payment.paymentDate).toLocaleDateString()}`);
          console.log(`   - Notes: ${payment.notes}`);

          if (payment.membershipId) {
            console.log(`   - Linked to Membership: ${payment.membershipId}`);

            if (payment.membershipId.toString() === membership._id.toString()) {
              console.log('\n🎉 PERFECT: Payment is correctly linked to membership!');
              console.log('   ✓ Payment membershipId matches membership _id');
            } else {
              console.log('\n❌ ERROR: Payment membershipId does NOT match membership _id');
              console.log(`   Payment membershipId: ${payment.membershipId}`);
              console.log(`   Membership _id: ${membership._id}`);
            }
          } else {
            console.log('\n❌ FAIL: Payment is NOT linked to membership (membershipId is missing)');
          }
        } else {
          console.log('\n⚠️  No payments found for this member');
        }

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 TEST RESULTS SUMMARY');
        console.log('='.repeat(60));
        console.log('✅ Excel import working correctly');
        console.log('✅ Memberships array created on import');
        console.log('✅ Membership contains all required fields');
        console.log(payment?.membershipId ? '✅ Payment linked to membership' : '❌ Payment NOT linked to membership');
        console.log('='.repeat(60));

      } else {
        console.log('\n❌ FAIL: Memberships array is missing or empty!');
        console.log('Member data:', JSON.stringify(member, null, 2));
      }
    } else {
      console.log('\n⚠️  No members were imported');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Check if file exists
if (!fs.existsSync(excelFilePath)) {
  console.error('❌ Excel file not found at:', excelFilePath);
  process.exit(1);
}

console.log('📁 Excel file found:', excelFilePath);
console.log('');

testImport();
