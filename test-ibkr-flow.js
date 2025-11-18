#!/usr/bin/env node

/**
 * Test script for IBKR connection flow
 * This mimics what the frontend does when user clicks "Connect IBKR Account"
 */

async function testIBKRFlow() {
  const BASE_URL = 'http://localhost:5000';

  console.log('Testing IBKR Connection Flow...\n');

  // Step 1: Check current diagnostics
  console.log('1. Checking IBKR diagnostics...');
  try {
    const diagResponse = await fetch(`${BASE_URL}/api/broker/diag`);
    const diag = await diagResponse.json();
    console.log('   Provider:', diag.provider);
    console.log('   Environment:', diag.env);
    console.log('   OAuth status:', diag.last.oauth.status || 'Not attempted');
    console.log('   SSO status:', diag.last.sso.status || 'Not attempted');
  } catch (error) {
    console.error('   Error:', error.message);
  }

  // Step 2: Run OAuth
  console.log('\n2. Running IBKR OAuth...');
  try {
    const oauthResponse = await fetch(`${BASE_URL}/api/broker/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const oauth = await oauthResponse.json();
    console.log('   Result:', oauth.ok ? 'SUCCESS' : 'FAILED');
    if (oauth.code) console.log('   Code:', oauth.code);
    if (oauth.error) console.log('   Error:', oauth.error);
    if (oauth.traceId) console.log('   Trace ID:', oauth.traceId);
  } catch (error) {
    console.error('   Error:', error.message);
  }

  // Step 3: Create SSO Session
  console.log('\n3. Creating SSO session...');
  try {
    const ssoResponse = await fetch(`${BASE_URL}/api/broker/sso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const sso = await ssoResponse.json();
    console.log('   Result:', sso.ok ? 'SUCCESS' : 'FAILED');
    if (sso.code) console.log('   Code:', sso.code);
    if (sso.error) console.log('   Error:', sso.error);
    if (sso.traceId) console.log('   Trace ID:', sso.traceId);
  } catch (error) {
    console.error('   Error:', error.message);
  }

  // Step 4: Check final diagnostics
  console.log('\n4. Checking final diagnostics...');
  try {
    const finalDiagResponse = await fetch(`${BASE_URL}/api/broker/diag`);
    const finalDiag = await finalDiagResponse.json();
    console.log('   OAuth status:', finalDiag.last.oauth.status || 'Not attempted');
    console.log('   SSO status:', finalDiag.last.sso.status || 'Not attempted');

    const isConnected = finalDiag.last.oauth.status === 200 && finalDiag.last.sso.status === 200;
    console.log('\n✅ IBKR Connection:', isConnected ? 'SUCCESSFUL' : 'FAILED');
  } catch (error) {
    console.error('   Error:', error.message);
  }
}

// Run the test
testIBKRFlow().catch(console.error);