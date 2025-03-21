const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const Pact = require('pact-lang-api');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Helper functions
const creationTime = () => Math.round((new Date).getTime()/1000)-15;
const dumMeta = (chainId) => Pact.lang.mkMeta("not-real", chainId, 0.00000001, 6000, creationTime(), 600);

async function getVersion(server) {
  try {
    const res = await fetch(`https://${server}/info`);
    const resJSON = await res.json();
    const av = resJSON.nodeApiVersion;
    const nv = resJSON.nodeVersion;
    
    let chainIds = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    
    if (resJSON.nodeChains && resJSON.nodeChains.length !== 10) {
      const bh = resJSON.nodeGraphHistory[0][0];
      const len = resJSON.nodeGraphHistory[0][1].length;
      const cut = await fetch(`https://${server}/chainweb/${av}/${nv}/cut`);
      const cutJSON = await cut.json();
      const h = cutJSON.height;
      
      if (h > bh) {
        chainIds = Array.from(Array(len).keys()).map(x => x.toString());
      }
    }
    
    return {
      nv: nv,
      chainIds: chainIds
    };
  } catch(e) {
    console.error("Error fetching version:", e);
    throw new Error("Unable to fetch from server");
  }
}

async function getBalance(host, token, acctName, chainId) {
  try {
    const response = await Pact.fetch.local({
      pactCode: `(${token}.details ${acctName})`,
      meta: dumMeta(chainId)
    }, host(chainId));
    
    const result = response.result;
    if (result.status === "success") {
      let bal = result.data
        ? (typeof result.data.balance === "number")
          ? result.data.balance
          : (result.data.balance.decimal ? result.data.balance.decimal : 0)
        : 0;
      
      return {
        chainId,
        balance: Number(bal),
        guard: result.data.guard,
        status: "success"
      };
    } else {
      return {
        chainId,
        balance: 0,
        status: "not_found"
      };
    }
  } catch(e) {
    console.error(`Error fetching balance for chain ${chainId}:`, e);
    return {
      chainId,
      balance: 0,
      status: "error",
      error: e.message
    };
  }
}

// Main API endpoint
app.get('/api/balance', async (req, res) => {
  try {
    const { account, token = 'coin', server = 'api.chainweb.com' } = req.query;
    
    if (!account) {
      return res.status(400).json({ error: 'Account parameter is required' });
    }
    
    const acctName = JSON.stringify(account);
    const info = await getVersion(server);
    const host = (chainId) => `https://${server}/chainweb/0.0/${info.nv}/chain/${chainId}/pact`;
    
    // Fetch balances from all chains in parallel
    const balancePromises = info.chainIds.map(chainId => 
      getBalance(host, token, acctName, chainId)
    );
    
    const results = await Promise.all(balancePromises);
    
    // Calculate total balance
    const totalBalance = results.reduce((sum, result) => sum + result.balance, 0);
    
    // Format response
    const response = {
      account: account,
      token: token,
      totalBalance: totalBalance,
      chains: results
    };
    
    res.json(response);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Kadena Balance API running on port ${PORT}`);
}); 