// Quick test script for the new batched period-map API
// Run this with: node test-batch-api.js

const testBatchAPI = async () => {
  const testData = {
    leaseIds: [
      '4d1e925a-e708-476d-904e-67feb469d298',
      'f65931ee-a5b2-43e8-9eeb-627b3c1f2e7a'
    ],
    from: '2025-06-29',
    to: '2025-10-26'
  };

  try {
    console.log('🧪 Testing new batched period-map API...');
    console.log('Request data:', JSON.stringify(testData, null, 2));

        const response = await fetch('http://localhost:3001/api/rent/period-map', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData),
    });

    console.log(`\n📊 Response Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Success! Response data:');
      console.log(`   - Rows returned: ${data.rows?.length || 0}`);
      console.log('   - Sample row:', data.rows?.[0] || 'No rows');
    } else {
      const errorData = await response.json();
      console.log('❌ Error response:');
      console.log(JSON.stringify(errorData, null, 2));
    }
  } catch (error) {
    console.error('💥 Network error:', error.message);
  }
};

// Run the test
testBatchAPI();
