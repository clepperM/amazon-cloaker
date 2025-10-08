const crypto = require('crypto');
const https = require('https');

// Amazon API Configuration - Using correct variable names
const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const PARTNER_TAG = process.env.PARTNER_TAG || 'onelastlynx-20';

exports.handler = async (event, context) => {
  let asin = null;
  
  // Check if it's a URL parameter format: /?url=https://amazon.com/...
  const urlParam = event.queryStringParameters?.url;
  if (urlParam) {
    asin = extractASINFromURL(decodeURIComponent(urlParam));
  } else {
    // Check if it's a direct ASIN format: /B09P21T2GC
    const pathAsin = event.path.replace('/', '').split('/')[0];
    if (pathAsin && pathAsin.length === 10 && /^[A-Z0-9]{10}$/i.test(pathAsin)) {
      asin = pathAsin;
    }
  }
  
  if (!asin) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'text/html',
      },
      body: generateErrorHTML()
    };
  }

  try {
    // Check if we have API credentials
    if (!ACCESS_KEY || !SECRET_KEY) {
      console.log('Amazon API credentials not found. ACCESS_KEY present:', !!ACCESS_KEY, 'SECRET_KEY present:', !!SECRET_KEY);
      console.log('Falling back to scraping');
      const productData = await fetchAmazonProductScraping(asin);
      const html = generateHTML(productData, asin);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
        },
        body: html
      };
    }

    console.log('Using PA-API 5.0 for ASIN:', asin);
    
    // Fetch Amazon product data using PA-API 5.0
    const productData = await fetchAmazonProductAPI(asin);
    
    // Generate HTML with OpenGraph tags
    const html = generateHTML(productData, asin);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: html
    };
  } catch (error) {
    console.error('PA-API 5.0 Error:', error.message);
    
    // Fallback to scraping if API fails
    try {
      console.log('API failed, attempting scraping fallback');
      const productData = await fetchAmazonProductScraping(asin);
      const html = generateHTML(productData, asin);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
        },
        body: html
      };
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      const fallbackHtml = generateFallbackHTML(asin);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
        },
        body: fallbackHtml
      };
    }
  }
};

function extractASINFromURL(url) {
  // Handle amzn.to short links by checking known mappings first
  const shortLinkMappings = {
    'amzn.to/468mKVM': 'B09P21T2GC'
    // Add more mappings as needed
  };
  
  // Check for known short links
  for (const [shortUrl, asin] of Object.entries(shortLinkMappings)) {
    if (url.includes(shortUrl)) {
      return asin;
    }
  }
  
  // Extract from standard Amazon URLs
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/product\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /asin=([A-Z0-9]{10})/i,
    /\/([A-Z0-9]{10})(?:\/|$|\?)/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && /^[A-Z0-9]{10}$/i.test(match[1])) {
      return match[1];
    }
  }
  
  return null;
}

// Amazon Product Advertising API 5.0 Implementation - CORRECTED
async function fetchAmazonProductAPI(asin) {
  const method = 'POST';
  const service = 'ProductAdvertisingAPI';
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
  const region = 'us-east-1';
  const host = 'webservices.amazon.com';
  const endpoint = `https://${host}`;
  
  // Request payload for PA-API 5.0
  const payload = JSON.stringify({
    ItemIds: [asin],
    Resources: [
      'ItemInfo.Title',
      'ItemInfo.Features', 
      'Images.Primary.Large',
      'Images.Primary.Medium',
      'Images.Primary.Small',
      'Offers.Listings.Price',
      'ItemInfo.ProductInfo'
    ],
    PartnerTag: PARTNER_TAG,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.com'
  });
  
  // Create timestamp FIRST - use consistent timing
  const timestamp = new Date();
  const dateStamp = timestamp.toISOString().substring(0, 10).replace(/-/g, '');
  const amzDate = timestamp.toISOString().replace(/[:-]|\.\d{3}/g, '');
  
  // Create AWS Signature Version 4 - FIXED canonical request
  const canonicalUri = '/paapi5/getitems';
  const canonicalQuerystring = '';
  // CRITICAL: Headers must be in alphabetical order and lowercase
  const canonicalHeaders = [
    `content-type:application/json; charset=utf-8`,
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`
  ].join('\n') + '\n';
  
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
  const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  console.log('Canonical Request:', canonicalRequest);
  
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  ].join('\n');
  
  console.log('String to Sign:', stringToSign);
  
  // Create signing key - FIXED: Use binary encoding properly
  const kDate = crypto.createHmac('sha256', `AWS4${SECRET_KEY}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  console.log('Authorization Header:', authorization);
  
  return new Promise((resolve, reject) => {
    const options = {
      method: method,
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'X-Amz-Date': amzDate,
        'X-Amz-Target': target,
        'Content-Length': Buffer.byteLength(payload, 'utf8')
      }
    };

    const req = https.request(endpoint + canonicalUri, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('PA-API 5.0 Response Status:', res.statusCode);
        console.log('PA-API 5.0 Response Headers:', res.headers);
        
        try {
          const response = JSON.parse(data);
          console.log('PA-API 5.0 Response:', JSON.stringify(response, null, 2));
          
          // Check for errors in response
          if (response.Errors && response.Errors.length > 0) {
            console.error('PA-API 5.0 Error:', response.Errors[0].Message);
            console.error('Error Code:', response.Errors[0].Code);
            reject(new Error(`PA-API Error: ${response.Errors[0].Message}`));
            return;
          }
          
          // Check for internal failure
          if (response.Output && response.Output.__type && response.Output.__type.includes('InternalFailure')) {
            console.error('PA-API 5.0 Internal Failure - likely authentication issue');
            console.error('Check your credentials: ACCESS_KEY, SECRET_KEY, and PARTNER_TAG');
            console.error('Full response:', JSON.stringify(response, null, 2));
            reject(new Error('PA-API Authentication Failed - Check your credentials'));
            return;
          }
          
          const productData = parsePAAPI5Response(response, asin);
          console.log('Parsed product data:', productData);
          resolve(productData);
        } catch (parseError) {
          console.error('PA-API 5.0 Parse error:', parseError);
          console.error('Raw response:', data);
          reject(parseError);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('PA-API 5.0 Request error:', error);
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      req.abort();
      reject(new Error('PA-API 5.0 request timeout'));
    });
    
    req.write(payload, 'utf8');
    req.end();
  });
}

// Parse PA-API 5.0 JSON response
function parsePAAPI5Response(response, asin) {
  let title = '';
  let image = '';
  let price = '';
  
  try {
    if (response.ItemsResult && response.ItemsResult.Items && response.ItemsResult.Items.length > 0) {
      const item = response.ItemsResult.Items[0];
      
      // Extract title
      if (item.ItemInfo && item.ItemInfo.Title && item.ItemInfo.Title.DisplayValue) {
        title = item.ItemInfo.Title.DisplayValue;
      }
      
      // Extract image - try multiple sizes
      if (item.Images && item.Images.Primary) {
        if (item.Images.Primary.Large && item.Images.Primary.Large.URL) {
          image = item.Images.Primary.Large.URL;
        } else if (item.Images.Primary.Medium && item.Images.Primary.Medium.URL) {
          image = item.Images.Primary.Medium.URL;
        } else if (item.Images.Primary.Small && item.Images.Primary.Small.URL) {
          image = item.Images.Primary.Small.URL;
        }
      }
      
      // Extract price
      if (item.Offers && item.Offers.Listings && item.Offers.Listings.length > 0) {
        const listing = item.Offers.Listings[0];
        if (listing.Price && listing.Price.DisplayAmount) {
          price = listing.Price.DisplayAmount;
        }
      }
    }
  } catch (parseError) {
    console.error('Error parsing PA-API 5.0 response:', parseError);
  }
  
  return {
    title: title || `Amazon Product ${asin}`,
    image: image || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
    price: price,
    asin: asin
  };
}

// IMPROVED Fallback scraping function with better selectors and image quality
async function fetchAmazonProductScraping(asin) {
  const { parse } = require('node-html-parser');
  
  // Try multiple User-Agent strings - more recent ones
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];
  
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.amazon.com',
      path: `/dp/${asin}`,
      method: 'GET',
      headers: {
        'User-Agent': randomUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Check if Amazon blocked the request
          if (data.includes('Robot Check') || data.includes('blocked') || data.length < 1000) {
            console.log('Amazon blocked scraping request for ASIN:', asin);
            resolve({
              title: `Amazon Product ${asin}`,
              image: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
              price: '',
              asin: asin
            });
            return;
          }
          
          const root = parse(data);
          
          // IMPROVED: Extract product title with more selectors and better cleaning
          let title = '';
          const titleSelectors = [
            '#productTitle',
            '[data-automation-id="product-title"]',
            '.product-title', 
            'h1.a-size-large',
            'h1[data-automation-id="product-title"]',
            '.a-size-large.product-title-word-break',
            'span#productTitle',
            'h1.a-size-base-plus'
          ];
          
          for (const selector of titleSelectors) {
            const element = root.querySelector(selector);
            if (element && element.text.trim()) {
              title = element.text.trim();
              // Clean up title - remove extra whitespace and common Amazon suffixes
              title = title
                .replace(/\s+/g, ' ')
                .replace(/\s*-\s*Amazon\.com$/, '')
                .replace(/\s*\|\s*Amazon\.com$/, '')
                .trim();
              break;
            }
          }
          
          // IMPROVED: Extract product image with better quality and more attempts
          let image = '';
          const imageSelectors = [
            '#landingImage',
            '.a-dynamic-image',
            'img[data-old-hires]',
            '.imgTagWrapper img',
            '#main-image',
            '.a-button-thumbnail img',
            'img[src*="images-na.ssl-images-amazon.com"]',
            'img[data-a-dynamic-image]'
          ];
          
          for (const selector of imageSelectors) {
            const element = root.querySelector(selector);
            if (element) {
              let rawImage = element.getAttribute('data-old-hires') || 
                            element.getAttribute('src') ||
                            element.getAttribute('data-a-dynamic-image') ||
                            element.getAttribute('data-src');
                            
              if (rawImage && (rawImage.includes('images-na.ssl-images-amazon.com') || rawImage.includes('m.media-amazon.com'))) {
                // Parse dynamic image JSON if present
                if (rawImage.startsWith('{')) {
                  try {
                    const imageData = JSON.parse(rawImage);
                    const imageUrls = Object.keys(imageData);
                    // Get the largest image available
                    image = imageUrls.sort((a, b) => {
                      const aSize = parseInt(a.match(/_SX(\d+)_/) || a.match(/(\d+)x\d+/) || [0, 0])[1] || 0;
                      const bSize = parseInt(b.match(/_SX(\d+)_/) || b.match(/(\d+)x\d+/) || [0, 0])[1] || 0;
                      return bSize - aSize;
                    })[0];
                  } catch (e) {
                    const match = rawImage.match(/"([^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
                    if (match) image = match[1];
                  }
                } else {
                  image = rawImage;
                }
                
                // IMPROVED: Force higher resolution and better quality
                if (image && (image.includes('amazon.com') || image.includes('ssl-images-amazon'))) {
                  image = image
                    // Remove size restrictions and force larger images
                    .replace(/\._[A-Z0-9,_]*\./g, '._AC_SL1500_.')
                    .replace(/\._SX\d+_/g, '._SX1500_')
                    .replace(/\._SY\d+_/g, '._SY1500_')
                    .replace(/\._AC_UL\d+_/g, '._AC_UL1500_')
                    .replace(/\._AC_UY\d+_/g, '._AC_UY1500_')
                    // Ensure we get the highest quality
                    .replace(/\._SS\d+_/g, '._SL1500_')
                    // Remove compression artifacts parameters
                    .replace(/,\d+_/g, '_');
                }
                break;
              }
            }
          }
          
          // IMPROVED: Extract price with more selectors
          let price = '';
          const priceSelectors = [
            '.a-price.a-text-price.a-size-medium.apexPriceToPay .a-offscreen',
            '.a-price .a-offscreen',
            '.a-price-whole',
            '.a-price-symbol + .a-price-whole',
            '#price_inside_buybox',
            '.a-price.a-text-price .a-offscreen',
            '[data-automation-id="list-price"] .a-offscreen',
            '.a-price-current .a-offscreen'
          ];
          
          for (const selector of priceSelectors) {
            const element = root.querySelector(selector);
            if (element && element.text.includes('$')) {
              price = element.text.trim();
              break;
            }
          }
          
          // If no price found, try one more method
          if (!price) {
            const priceElement = root.querySelector('.a-price');
            if (priceElement) {
              const priceText = priceElement.text;
              const priceMatch = priceText.match(/\$[\d,]+\.?\d*/);
              if (priceMatch) {
                price = priceMatch[0];
              }
            }
          }
          
          const result = {
            title: title || `Amazon Product ${asin}`,
            image: image || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
            price: price,
            asin: asin
          };
          
          console.log('Scraping result:', result);
          resolve(result);
          
        } catch (parseError) {
          console.error('Parse error:', parseError);
          resolve({
            title: `Amazon Product ${asin}`,
            image: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
            price: '',
            asin: asin
          });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
    
    req.setTimeout(15000, () => { // Increased timeout
      req.abort();
      reject(new Error('Scraping request timeout'));
    });
    
    req.end();
  });
}

function generateHTML(productData, asin) {
  const affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${PARTNER_TAG}`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- Google Analytics 4 -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-V17N2H7EB8"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-V17N2H7EB8', {
        'page_title': 'Product Redirect - ${asin}',
        'page_path': '/${asin}'
      });
      
      // Track redirect click event
      gtag('event', 'product_view', {
        'event_category': 'Product',
        'event_label': '${asin}',
        'product_title': '${productData.title}',
        'product_price': '${productData.price || 'N/A'}'
      });
    </script>
    
    <!-- OpenGraph Tags -->
    <meta property="og:title" content="${productData.title}">
    <meta property="og:description" content="Check out this amazing deal on Amazon! ${productData.price ? 'Price: ' + productData.price : 'Great value!'}">
    <meta property="og:image" content="${productData.image}">
    <meta property="og:url" content="https://go.onelastlink.com/${asin}">
    <meta property="og:type" content="product">
    <meta property="og:site_name" content="amazon.com">
    
    <!-- Twitter Cards -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${productData.title}">
    <meta name="twitter:description" content="Check out this amazing deal on Amazon!">
    <meta name="twitter:image" content="${productData.image}">
    
    <title>${productData.title}</title>
    
    <style>
        :root {
            --amazon-orange: #FF9900;
            --amazon-dark: #131921;
            --amazon-light: #EAEDED;
            --amazon-blue: #146EB4;
            --brand-cyan: #00E5E0;
            --text-primary: #0F1111;
            --text-secondary: #565959;
            --border-color: #D5D9D9;
            --price-red: #B12704;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Amazon Ember', Arial, sans-serif;
            background: #FFFFFF;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            background: var(--amazon-dark);
            padding: 8px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .logo-section {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .amazon-logo {
            color: white;
            font-size: 22px;
            font-weight: bold;
            letter-spacing: -1px;
        }
        
        .divider-line {
            height: 30px;
            width: 1px;
            background: #48525C;
        }
        
        .powered-by {
            color: #999;
            font-size: 11px;
        }
        
        .brand-link {
            color: var(--brand-cyan);
            text-decoration: none;
            font-weight: 500;
        }
        
        .main-container {
            max-width: 1500px;
            margin: 0 auto;
            padding: 20px;
            display: flex;
            gap: 40px;
            flex: 1;
        }
        
        .image-section {
            flex: 0 0 400px;
        }
        
        .image-container {
            position: sticky;
            top: 20px;
            background: white;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
        }
        
        .product-image {
            width: 100%;
            max-width: 360px;
            height: auto;
            object-fit: contain;
        }
        
        .details-section {
            flex: 1;
            max-width: 700px;
        }
        
        .product-title {
            font-size: 24px;
            font-weight: 400;
            line-height: 32px;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        
        .rating-line {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 14px;
        }
        
        .stars {
            color: var(--amazon-orange);
        }
        
        .rating-link {
            color: var(--amazon-blue);
            text-decoration: none;
        }
        
        .divider {
            border: 0;
            height: 1px;
            background: #e7e7e7;
            margin: 12px 0;
        }
        
        .price-box {
            background: var(--amazon-light);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
        }
        
        .price-label {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        
        .price {
            font-size: 28px;
            color: var(--price-red);
            font-weight: 400;
            line-height: 1.3;
        }
        
        .redirect-box {
            background: #FFF8E1;
            border: 1px solid #FFE082;
            border-radius: 8px;
            padding: 12px 16px;
            margin: 16px 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .spinner {
            width: 20px;
            height: 20px;
            border: 3px solid #FFA726;
            border-top: 3px solid transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .redirect-text {
            color: var(--text-primary);
            font-size: 14px;
        }
        
        .countdown {
            font-weight: 700;
            color: var(--price-red);
        }
        
        .buy-button {
            display: block;
            width: 100%;
            max-width: 300px;
            background: var(--amazon-orange);
            color: #111;
            text-align: center;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 13px;
            border: 1px solid #FFA724;
            transition: background 0.15s;
            box-shadow: 0 2px 5px rgba(213,217,217,.5);
            margin-top: 8px;
        }
        
        .buy-button:hover {
            background: #F7CA00;
            border-color: #F2C200;
        }
        
        .footer {
            background: var(--amazon-dark);
            color: #999;
            text-align: center;
            padding: 16px;
            font-size: 12px;
            margin-top: auto;
        }
        
        .footer-link {
            color: var(--brand-cyan);
            text-decoration: none;
        }
        
        @media (max-width: 968px) {
            .main-container {
                flex-direction: column;
            }
            
            .image-section {
                flex: none;
            }
            
            .image-container {
                position: relative;
                top: 0;
            }
        }
        
        @media (max-width: 480px) {
            .header {
                padding: 8px 12px;
            }
            
            .main-container {
                padding: 12px;
                gap: 20px;
            }
            
            .product-title {
                font-size: 20px;
                line-height: 28px;
            }
            
            .price {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo-section">
            <div class="amazon-logo">amazon</div>
            <div class="divider-line"></div>
            <div class="powered-by">
                via <a href="https://onelastlink.com" class="brand-link">One Last Link</a>
            </div>
        </div>
    </div>
    
    <div class="main-container">
        <div class="image-section">
            <div class="image-container">
                <img src="${productData.image}" alt="${productData.title}" class="product-image">
            </div>
        </div>
        
        <div class="details-section">
            <h1 class="product-title">${productData.title}</h1>
            
            <div class="rating-line">
                <span class="stars">★★★★★</span>
                <a href="#" class="rating-link">See customer reviews</a>
            </div>
            
            <hr class="divider">
            
            ${productData.price ? `
            <div class="price-box">
                <div class="price-label">Price:</div>
                <div class="price">${productData.price}</div>
            </div>
            ` : ''}
            
            <div class="redirect-box">
                <div class="spinner"></div>
                <div class="redirect-text">
                    Redirecting to Amazon in <span id="countdown" class="countdown">3</span> seconds
                </div>
            </div>
            
            <a href="${affiliateUrl}" class="buy-button" id="amazon-button">
                Continue to Amazon
            </a>
            
            <div style="margin-top: 16px; color: var(--text-secondary); font-size: 12px;">
                ✓ Secure checkout on Amazon.com<br>
                ✓ Free returns on eligible items
            </div>
        </div>
    </div>
    
    <div class="footer">
        Secured by <a href="https://onelastlink.com" class="footer-link">One Last Link</a> • Trusted affiliate partner
    </div>
    
    <script>
        let countdown = 999;
        const el = document.getElementById('countdown');
        
        const timer = setInterval(() => {
            countdown--;
            el.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(timer);
                
                // Track outbound click before redirect
                gtag('event', 'click', {
                  'event_category': 'Outbound Link',
                  'event_label': 'Amazon Redirect - ${asin}',
                  'transport_type': 'beacon',
                  'event_callback': function() {
                    window.location.href = '${affiliateUrl}';
                  }
                });
                
                // Fallback in case callback doesn't fire
                setTimeout(function() {
                  window.location.href = '${affiliateUrl}';
                }, 250);
            }
        }, 1000);
        
        // Track manual button clicks
        document.getElementById('amazon-button').addEventListener('click', function(e) {
            gtag('event', 'click', {
              'event_category': 'Manual Click',
              'event_label': 'Amazon Button - ${asin}'
            });
        });
    </script>
</body>
</html>`;
}

function generateFallbackHTML(asin) {
  const affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${PARTNER_TAG}`;
  const fallbackImage = `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <meta property="og:title" content="Amazing Amazon Deal">
    <meta property="og:description" content="Check out this great deal I found on Amazon!">
    <meta property="og:image" content="${fallbackImage}">
    <meta property="og:url" content="https://go.onelastlink.com/${asin}">
    <meta property="og:type" content="product">
    <meta property="og:site_name" content="amazon.com">
    
    <title>Amazon Deal - ${asin}</title>
    
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #000000;
            color: white;
            text-align: center;
            padding: 50px;
            margin: 0;
        }
        .container {
            max-width: 400px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            padding: 30px;
            border-radius: 15px;
        }
        .button {
            display: inline-block;
            background: #0F9AA0;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>🎯 Redirecting to Amazon...</h2>
        <p>Taking you to your deal...</p>
        <a href="${affiliateUrl}" class="button">Go to Amazon</a>
    </div>
    <script>
        setTimeout(() => {
            window.location.href = '${affiliateUrl}';
        }, 2000);
    </script>
</body>
</html>`;
}

function generateErrorHTML() {
  return `
    <!DOCTYPE html>
    <html>
    <head><title>Invalid Link</title></head>
    <body style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
      <h2>❌ Invalid Amazon Link</h2>
      <p>Please use one of these formats:</p>
      <p><code>go.onelastlink.com/B09P21T2GC</code></p>
      <p><code>go.onelastlink.com/?url=https://amazon.com/dp/B09P21T2GC</code></p>
    </body>
    </html>
  `;
}






