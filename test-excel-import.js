const XLSX = require('xlsx');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

// Create test Excel data
const testData = [
  {
    'ID. NO': 'TEST001',
    'Client Name': 'Test Member Excel',
    'Phone Number': '9999888877',
    'PACKAGE': '3MONTH',
    'AMOUNT': 3000,
    'RECEIVED': 2000,
    'BALANCE': 1000,
    'M.O.P': 'Cash',
    'DATE': '2026-03-01',
    'Starting Date': '2026-03-01',
    'Expiry Date': '2026-06-01',
    'Training Type': 'GT',
    'Trainer': 'Test Trainer',
    'Sales Person': 'Test Sales',
    'Member Type': 'New'
  }
];

// Create workbook and worksheet
const ws = XLSX.utils.json_to_sheet(testData);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Members');

// Write to file
const filename = '/tmp/test-members.xlsx';
XLSX.writeFile(wb, filename);
console.log('✅ Created test Excel file:', filename);

// Now import it
async function testImport() {
  try {
    // First, login to get token
    console.log('\n🔐 Logging in...');
    const loginResponse = await axios.post('http://localhost:5000/auth/admin/login', {
      email: 'admin@backendgym.com',
      password: 'Admin@123'
    });

    const token = loginResponse.data.accessToken;
    console.log('✅ Login successful, got token');

    // Create form data
    const form = new FormData();
    form.append('file', fs.createReadStream(filename));

    // Import the Excel file
    console.log('\n📤 Importing Excel file...');
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
    console.log('\nImport Result:', JSON.stringify(importResponse.data, null, 2));

    // Get the imported member ID
    if (importResponse.data.imported && importResponse.data.imported.length > 0) {
      const memberId = importResponse.data.imported[0].member._id;
      console.log('\n📋 Imported Member ID:', memberId);

      // Fetch the member to verify memberships array
      console.log('\n🔍 Fetching member details to verify memberships array...');
      const memberResponse = await axios.get(
        `http://localhost:5000/members/${memberId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      console.log('\n✅ Member Details:');
      console.log(JSON.stringify(memberResponse.data, null, 2));

      // Check memberships array
      if (memberResponse.data.memberships && memberResponse.data.memberships.length > 0) {
        console.log('\n✅ SUCCESS: Memberships array exists!');
        console.log('Membership Details:', JSON.stringify(memberResponse.data.memberships[0], null, 2));

        // Get payment to verify it's linked to membership
        console.log('\n🔍 Fetching payment details...');
        const paymentId = importResponse.data.imported[0].payment._id;
        const paymentResponse = await axios.get(
          `http://localhost:5000/members/${memberId}/payments`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        console.log('\n✅ Payment Details:');
        console.log(JSON.stringify(paymentResponse.data, null, 2));

        if (paymentResponse.data.length > 0 && paymentResponse.data[0].membershipId) {
          console.log('\n✅ SUCCESS: Payment is linked to membership!');
          console.log('Payment membershipId:', paymentResponse.data[0].membershipId);
          console.log('Membership _id:', memberResponse.data.memberships[0]._id);

          if (paymentResponse.data[0].membershipId === memberResponse.data.memberships[0]._id) {
            console.log('\n🎉 PERFECT: Payment membershipId matches membership _id!');
          }
        } else {
          console.log('\n❌ FAIL: Payment is NOT linked to membership');
        }
      } else {
        console.log('\n❌ FAIL: Memberships array is missing or empty!');
      }
    }

    // Cleanup
    fs.unlinkSync(filename);
    console.log('\n🗑️ Cleaned up test file');

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    // Cleanup even on error
    if (fs.existsSync(filename)) {
      fs.unlinkSync(filename);
    }
  }
}

testImport();
