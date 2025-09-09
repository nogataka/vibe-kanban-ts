#!/usr/bin/env node

/**
 * Test script for GitHub merge functionality
 * Tests the new Octokit-based merge endpoints
 */

const BASE_URL = 'http://localhost:3001';

// Test data
const testPullNumber = 1; // Change this to an actual PR number

async function testMergeEndpoints() {
  console.log('🧪 Testing GitHub Merge API endpoints...\n');

  // Test 1: Check mergeability
  console.log('1️⃣ Testing GET /api/github/pulls/:pull_number/merge (Check mergeability)');
  try {
    const response = await fetch(`${BASE_URL}/api/github/pulls/${testPullNumber}/merge`);
    const data = await response.json();
    console.log('✅ Mergeability check:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to check mergeability:', error.message);
  }

  console.log('\n---\n');

  // Test 2: Merge pull request (commented out for safety)
  console.log('2️⃣ Testing POST /api/github/pulls/:pull_number/merge (Merge PR)');
  console.log('⚠️  Skipping actual merge to avoid modifying repository');
  /*
  try {
    const response = await fetch(`${BASE_URL}/api/github/pulls/${testPullNumber}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commit_title: 'Merge PR via API test',
        commit_message: 'Testing merge functionality',
        merge_method: 'merge'
      })
    });
    const data = await response.json();
    console.log('✅ Merge result:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to merge PR:', error.message);
  }
  */

  console.log('\n---\n');

  // Test 3: Update PR branch
  console.log('3️⃣ Testing PUT /api/github/pulls/:pull_number/update-branch');
  console.log('⚠️  Skipping actual update to avoid modifying repository');
  /*
  try {
    const response = await fetch(`${BASE_URL}/api/github/pulls/${testPullNumber}/update-branch`, {
      method: 'PUT'
    });
    const data = await response.json();
    console.log('✅ Update branch result:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to update branch:', error.message);
  }
  */

  console.log('\n---\n');

  // Test 4: Close pull request
  console.log('4️⃣ Testing DELETE /api/github/pulls/:pull_number (Close PR)');
  console.log('⚠️  Skipping actual close to avoid modifying repository');
  /*
  try {
    const response = await fetch(`${BASE_URL}/api/github/pulls/${testPullNumber}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    console.log('✅ Close PR result:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to close PR:', error.message);
  }
  */

  console.log('\n✨ Test complete! (Destructive operations were skipped for safety)');
  console.log('To test actual merge/update/close operations, uncomment the relevant sections.');
}

// Run tests
testMergeEndpoints().catch(console.error);