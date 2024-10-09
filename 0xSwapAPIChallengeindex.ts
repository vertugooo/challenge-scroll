import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
  publicActions,
  concat,
  numberToHex,
  size,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { scroll } from "viem/chains";
import { wethAbi } from "./abi/weth-abi";

/* This script is designed for the 0x Challenge on Scroll. It aims to achieve the following tasks:

1. Show the distribution of liquidity sources as a percentage
2. Implement monetization through affiliate fees and surplus collection
3. Present buy/sell tax information for tokens that have such taxes
4. List all liquidity sources available on Scroll
*/

const qs = require("qs");

// Load environment variables from the .env file
dotenv();
const { PRIVATE_KEY, ZERO_EX_API_KEY, ALCHEMY_HTTP_TRANSPORT_URL } =
  process.env;

// Ensure all necessary environment variables are set
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY is missing.");
if (!ZERO_EX_API_KEY) throw new Error("ZERO_EX_API_KEY is missing.");
if (!ALCHEMY_HTTP_TRANSPORT_URL)
  throw new Error("ALCHEMY_HTTP_TRANSPORT_URL is missing.");

// Prepare headers for API requests
const headers = new Headers({
  "Content-Type": "application/json",
  "0x-api-key": ZERO_EX_API_KEY,
  "0x-version": "v2",
});

// Initialize the wallet client
const client = createWalletClient({
  account: privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`),
  chain: scroll,
  transport: http(ALCHEMY_HTTP_TRANSPORT_URL),
}).extend(publicActions); // Enhance the client with public actions

const [address] = await client.getAddresses();

// Define contract instances
const weth = getContract({
  address: "0x5300000000000000000000000000000000000004",
  abi: wethAbi,
  client,
});
const wsteth = getContract({
  address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
  abi: erc20Abi,
  client,
});

// Function to calculate and display the distribution of liquidity sources
function displayLiquiditySources(route: any) {
  const fills = route.fills;
  const totalBps = fills.reduce((acc: number, fill: any) => acc + parseInt(fill.proportionBps), 0);

  console.log(`${fills.length} Liquidity Sources`);
  fills.forEach((fill: any) => {
    const percentage = (parseInt(fill.proportionBps) / 100).toFixed(2);
    console.log(`${fill.source}: ${percentage}%`);
  });
}

// Function to show the buy/sell tax details for tokens
function displayTokenTaxes(tokenMetadata: any) {
  const buyTokenBuyTax = (parseInt(tokenMetadata.buyToken.buyTaxBps) / 100).toFixed(2);
  const buyTokenSellTax = (parseInt(tokenMetadata.buyToken.sellTaxBps) / 100).toFixed(2);
  const sellTokenBuyTax = (parseInt(tokenMetadata.sellToken.buyTaxBps) / 100).toFixed(2);
  const sellTokenSellTax = (parseInt(tokenMetadata.sellToken.sellTaxBps) / 100).toFixed(2);

  if (buyTokenBuyTax > 0 || buyTokenSellTax > 0) {
    console.log(`Buy Token Buy Tax: ${buyTokenBuyTax}%`);
    console.log(`Buy Token Sell Tax: ${buyTokenSellTax}%`);
  }

  if (sellTokenBuyTax > 0 || sellTokenSellTax > 0) {
    console.log(`Sell Token Buy Tax: ${sellTokenBuyTax}%`);
    console.log(`Sell Token Sell Tax: ${sellTokenSellTax}%`);
  }
}

// Function to retrieve and display all liquidity sources on the Scroll chain
const getLiquiditySources = async () => {
  const chainId = client.chain.id.toString(); // Get the ID for the Scroll chain
  const sourcesParams = new URLSearchParams({
    chainId: chainId,
  });

  const sourcesResponse = await fetch(
    `https://api.0x.org/swap/v1/sources?${sourcesParams.toString()}`,
    {
      headers,
    }
  );

  const sourcesData = await sourcesResponse.json();
  const sources = Object.keys(sourcesData.sources);
  console.log("Available liquidity sources for the Scroll chain:");
  console.log(sources.join(", "));
};

const main = async () => {
  // Fetch and display all liquidity sources for Scroll
  await getLiquiditySources();

  // Define the amount to sell
  const decimals = (await weth.read.decimals()) as number;
  const sellAmount = parseUnits("0.1", decimals);

  // Set parameters for affiliate fees and surplus collection
  const affiliateFeeBps = "100"; // 1% affiliate fee
  const surplusCollection = "true";

  // Construct the parameters for fetching the price
  const priceParams = new URLSearchParams({
    chainId: client.chain.id.toString(),
    sellToken: weth.address,
    buyToken: wsteth.address,
    sellAmount: sellAmount.toString(),
    taker: client.account.address,
    affiliateFee: affiliateFeeBps, // Affiliate fee parameter
    surplusCollection: surplusCollection, // Surplus collection parameter
  });

  const priceResponse = await fetch(
    "https://api.0x.org/swap/permit2/price?" + priceParams.toString(),
    {
      headers,
    }
  );

  const price = await priceResponse.json();
  console.log("Retrieving price for swapping 0.1 WETH to wstETH");
  console.log(
    `Price endpoint: https://api.0x.org/swap/permit2/price?${priceParams.toString()}`
  );
  console.log("Price response: ", price);

  // Verify if the taker needs to set an allowance for Permit2
  if (price.issues.allowance !== null) {
    try {
      const { request } = await weth.simulate.approve([
        price.issues.allowance.spender,
        maxUint256,
      ]);
      console.log("Granting Permit2 permission to utilize WETH...", request);
      // Execute approval
      const hash = await weth.write.approve(request.args);
      console.log(
        "Permit2 granted permission to use WETH.",
        await client.waitForTransactionReceipt({ hash })
      );
    } catch (error) {
      console.log("Error granting Permit2 permission:", error);
    }
  } else {
    console.log("WETH is already authorized for Permit2");
  }

  // Fetch the quote based on the monetization parameters
  const quoteParams = new URLSearchParams();
  for (const [key, value] of priceParams.entries()) {
    quoteParams.append(key, value);
  }

  const quoteResponse = await fetch(
    "https://api.0x.org/swap/permit2/quote?" + quoteParams.toString(),
    {
      headers,
    }
  );

  const quote = await quoteResponse.json();
  console.log("Retrieving quote for swapping 0.1 WETH to wstETH");
  console.log("Quote response: ", quote);

  // Display the percentage breakdown of liquidity sources from the quote
  if (quote.route) {
    displayLiquiditySources(quote.route);
  }

  // Show the buy/sell tax information from the quote
  if (quote.tokenMetadata) {
    displayTokenTaxes(quote.tokenMetadata);
  }

  // Present monetization details
  if (quote.affiliateFeeBps) {
    const affiliateFee = (parseInt(quote.affiliateFeeBps) / 100).toFixed(2);
    console.log(`Affiliate Fee: ${affiliateFee}%`);
  }

  if (quote.tradeSurplus && parseFloat(quote.tradeSurplus) > 0) {
    console.log(`Trade Surplus Achieved: ${quote.tradeSurplus}`);
  }

  // Sign the permit2.eip712 returned from the quote
  let signature: Hex | undefined;
  if (quote.permit2?.eip712) {
    try {
      signature = await client.signTypedData(quote.permit2.eip712);
      console.log("Successfully signed the permit2 message from quote response");
    } catch (error) {
      console.error("Error signing the permit2 coupon:", error);
    }

    // Append signature length and data to the transaction's data
    if (signature && quote?.transaction?.data) {
      const signatureLengthInHex = numberToHex(size(signature), {
        signed: false,
        size: 32,
      });

      const transactionData = quote.transaction.data as Hex;
      const sigLengthHex = signatureLengthInHex as Hex;
      const sig = signature as Hex;

      quote.transaction.data = concat([transactionData, sigLengthHex, sig]);
    } else {
      throw new Error("Unable to retrieve signature or transaction data");
    }
  }

  // Submit the transaction with the Permit2 signature
  if (signature && quote.transaction.data) {
    const nonce = await client.getTransactionCount({
      address: client.account.address,
    });

    const signedTransaction = await client.signTransaction({
      account: client.account,
      chain: client.chain,
      gas: quote?.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
      to: quote?.transaction.to,
      data: quote.transaction.data,
      value: quote?.transaction.value
        ? BigInt(quote.transaction.value)
        : undefined, // Used for native token value
      gasPrice: quote?.transaction.gasPrice
        ? BigInt(quote.transaction.gasPrice)
        : undefined,
      nonce: nonce,
    });
    const hash = await client.sendRawTransaction({
      serializedTransaction: signedTransaction,
    });

    console.log("Transaction hash:", hash);
    console.log(`Check transaction details at https://scrollscan.com/tx/${hash}`);
  } else {
    console.error("Failed to obtain a signature; transaction not executed.");
  }
};

main();
