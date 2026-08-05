import { getSimulatedAnalysis } from '../../lib/simulatedAnalysis.js';

async function run() {
  const symbols = ['UGI', 'LNG', 'DXCM', 'PTEN'];
  let ok = true;

  for (const sym of symbols) {
    try {
      const result = await getSimulatedAnalysis(sym, sym);
      // Basic shape checks
      if (!result || result.symbol !== sym) {
        console.error(`Invalid result for ${sym}: missing or wrong symbol`);
        ok = false;
        continue;
      }
      const allowedRecs = ['BUY', 'HOLD', 'SELL', 'NEUTRAL'];
      if (!allowedRecs.includes(result.recommendation)) {
        console.error(`Invalid recommendation for ${sym}:`, result.recommendation);
        ok = false;
      }
      if (!result.technicalSummary || typeof result.technicalSummary.summary !== 'string') {
        console.error(`Missing technicalSummary for ${sym}`);
        ok = false;
      }
      if (!Array.isArray(result.dataLimitations)) {
        console.error(`dataLimitations is not an array for ${sym}`);
        ok = false;
      }

      console.log(`OK ${sym}: recommendation=${result.recommendation}, confidence=${result.confidenceLevel}`);
    } catch (err) {
      console.error(`Error running simulated analysis for ${sym}:`, err);
      ok = false;
    }
  }

  if (!ok) process.exit(2);
  console.log('Simulated analysis smoke test passed.');
}

run();
