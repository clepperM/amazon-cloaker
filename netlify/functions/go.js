const https = require('https');
const { parse } = require('node-html-parser');

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
      body: `
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
      `
    };
  }

  try {
    // Fetch Amazon product data
    const productData = await fetchAmazonProduct(asin);
    
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
    console.error('Error:', error);
    
    // Fallback HTML
    const fallbackHtml = generateFallbackHTML(asin);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: fallbackHtml
    };
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

async function fetchAmazonProduct(asin) {
  // Try multiple User-Agent strings
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
  ];
  
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.amazon.com',
      path: `/dp/${asin}`,
      method: 'GET',
      headers: {
        'User-Agent': randomUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
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
            console.log('Amazon blocked request for ASIN:', asin);
            // Return fallback data instead of failing
            resolve({
              title: `Amazon Product ${asin}`,
              image: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
              price: '',
              asin: asin
            });
            return;
          }
          
          const root = parse(data);
          
          // Extract product title with more selectors
          let title = '';
          const titleSelectors = [
            '#productTitle',
            '.product-title', 
            'h1.a-size-large',
            'h1[data-automation-id="product-title"]',
            '.a-size-large.product-title-word-break'
          ];
          
          for (const selector of titleSelectors) {
            const element = root.querySelector(selector);
            if (element && element.text.trim()) {
              title = element.text.trim();
              break;
            }
          }
          
          // Extract product image with more attempts
          let image = '';
          const imageSelectors = [
            '#landingImage',
            '.a-dynamic-image',
            'img[data-old-hires]',
            '.imgTagWrapper img',
            '#main-image',
            '.a-button-thumbnail img'
          ];
          
          for (const selector of imageSelectors) {
            const element = root.querySelector(selector);
            if (element) {
              let rawImage = element.getAttribute('data-old-hires') || 
                            element.getAttribute('src') ||
                            element.getAttribute('data-a-dynamic-image') ||
                            element.getAttribute('data-src');
                            
              if (rawImage && rawImage.includes('images-na.ssl-images-amazon.com')) {
                // Parse dynamic image JSON if present
                if (rawImage.startsWith('{')) {
                  try {
                    const imageData = JSON.parse(rawImage);
                    const imageUrls = Object.keys(imageData);
                    image = imageUrls[imageUrls.length - 1];
                  } catch (e) {
                    const match = rawImage.match(/"([^"]*\.jpg[^"]*)"/);
                    if (match) image = match[1];
                  }
                } else {
                  image = rawImage;
                }
                
                // Force higher resolution
                if (image.includes('amazon.com') || image.includes('ssl-images-amazon')) {
                  image = image
                    .replace(/\._[A-Z0-9,_]*\./, '._AC_SL1500_.')
                    .replace(/\._SX\d+_/, '._SX1000_')
                    .replace(/\._SY\d+_/, '._SY1000_');
                }
                break;
              }
            }
          }
          
          // Extract price
          let price = '';
          const priceSelectors = [
            '.a-price .a-offscreen',
            '.a-price-whole',
            '.a-price-symbol + .a-price-whole',
            '#price_inside_buybox'
          ];
          
          for (const selector of priceSelectors) {
            const element = root.querySelector(selector);
            if (element && element.text.includes('$')) {
              price = element.text.trim();
              break;
            }
          }
          
          resolve({
            title: title || `Amazon Product ${asin}`,
            image: image || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
            price: price,
            asin: asin
          });
          
        } catch (parseError) {
          console.error('Parse error:', parseError);
          // Return fallback instead of rejecting
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
      // Return fallback instead of rejecting
      resolve({
        title: `Amazon Product ${asin}`,
        image: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
        price: '',
        asin: asin
      });
    });
    
    req.setTimeout(10000, () => {
      req.abort();
      // Return fallback instead of rejecting
      resolve({
        title: `Amazon Product ${asin}`,
        image: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SL1500_.jpg`,
        price: '',
        asin: asin
      });
    });
    
    req.end();
  });
}

function generateHTML(productData, asin) {
  const affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=onelastlynx-20`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
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
    
    <title>${productData.title} - OneLastLink</title>
    
    <!-- Custom Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    
    <style>
        :root {
            /* OneLastLink Brand Colors */
            --brand-black: #000000;        /* Primary black */
            --brand-blue: #0F9AA0;         /* Blue */
            --brand-red: #C43A3A;          /* Red */
            --brand-yellow: #FFD400;       /* Yellow */
            --brand-light: #f8fafc;        /* Light gray */
            --text-primary: #ffffff;       /* White text on black */
            --text-secondary: #a0a0a0;     /* Light gray text */
            --success: #0F9AA0;            /* Use brand blue for success */
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--brand-black);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            position: relative;
            overflow: hidden;
        }
        
        /* Animated background elements - subtle on black */
        body::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(15, 154, 160, 0.05) 1px, transparent 1px);
            background-size: 50px 50px;
            animation: float 20s infinite linear;
            pointer-events: none;
        }
        
        @keyframes float {
            0% { transform: translate(0, 0) rotate(0deg); }
            100% { transform: translate(-50px, -50px) rotate(360deg); }
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 40px;
            text-align: center;
            box-shadow: 
                0 25px 50px -12px rgba(0, 0, 0, 0.5),
                0 0 0 1px rgba(15, 154, 160, 0.2);
            max-width: 500px;
            width: 100%;
            position: relative;
            z-index: 1;
        }
        
        .brand-logo {
            margin-bottom: 20px;
            padding: 12px;
            background: var(--brand-black);
            border-radius: 16px;
            display: inline-block;
        }
        
        .brand-logo img {
            height: 32px;
            width: auto;
        }
        
        .brand-name {
            font-size: 24px;
            font-weight: 700;
            color: var(--brand-blue);
            margin-bottom: 8px;
            letter-spacing: -0.025em;
        }
        
        .brand-tagline {
            font-size: 14px;
            color: var(--brand-blue);
            margin-bottom: 30px;
        }
        
        .product-card {
            background: white;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(0, 0, 0, 0.05);
        }
        
        .product-image {
            width: 200px;
            height: 200px;
            object-fit: contain;
            border-radius: 12px;
            margin-bottom: 16px;
            background: #f9fafb;
            padding: 8px;
        }
        
        .product-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--brand-black);
            margin-bottom: 12px;
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        
        .product-price {
            font-size: 24px;
            font-weight: 700;
            color: var(--brand-red);
            margin-bottom: 16px;
        }
        
        .redirect-status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 24px;
            padding: 16px;
            background: rgba(255, 212, 0, 0.1);
            border-radius: 12px;
            border: 1px solid rgba(255, 212, 0, 0.3);
        }
        
        .status-icon {
            width: 20px;
            height: 20px;
            border: 2px solid var(--brand-yellow);
            border-top: 2px solid transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .redirect-text {
            color: var(--brand-black);
            font-weight: 500;
            font-size: 15px;
        }
        
        .countdown {
            font-weight: 700;
            color: var(--brand-yellow);
            font-size: 18px;
            margin: 0 4px;
        }
        
        .amazon-button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: linear-gradient(135deg, var(--brand-blue), #0d8287);
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 
                0 4px 15px rgba(15, 154, 160, 0.3),
                0 0 0 1px rgba(15, 154, 160, 0.1);
            border: none;
        }
        
        .amazon-button:hover {
            transform: translateY(-2px);
            box-shadow: 
                0 8px 25px rgba(15, 154, 160, 0.4),
                0 0 0 1px rgba(15, 154, 160, 0.2);
        }
        
        .amazon-button:active {
            transform: translateY(0);
        }
        
        .security-badge {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        .security-text {
            font-size: 12px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        
        .shield-icon {
            width: 16px;
            height: 16px;
            fill: var(--brand-blue);
        }
        
        /* Mobile responsive */
        @media (max-width: 480px) {
            .container {
                padding: 24px;
                margin: 10px;
            }
            
            .product-image {
                width: 150px;
                height: 150px;
            }
            
            .brand-name {
                font-size: 20px;
            }
            
            .product-title {
                font-size: 16px;
            }
        }
        
        /* Pulse animation for countdown */
        .countdown {
            animation: pulse 1s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Brand Header -->
        <div class="brand-logo">
            <img src="https://cdn.prod.website-files.com/6813bc8de3014317dbb7ce36/68b1450de3257ab4374d7a6b_webclip.png" alt="OneLastLink" />
        </div>
        <div class="brand-name">OneLastLink</div>
        <div class="brand-tagline">Your trusted link companion</div>
        
        <!-- Product Card -->
        <div class="product-card">
            <img src="${productData.image}" alt="${productData.title}" class="product-image">
            <h1 class="product-title">${productData.title}</h1>
            ${productData.price ? `<div class="product-price">${productData.price}</div>` : ''}
        </div>
        
        <!-- Redirect Status -->
        <div class="redirect-status">
            <div class="status-icon"></div>
            <div class="redirect-text">
                Taking you to Amazon in <span id="countdown" class="countdown">3</span> seconds
            </div>
        </div>
        
        <!-- Amazon Button -->
        <a href="${affiliateUrl}" class="amazon-button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03L21.7 4H5.21l-.94-2H1zm16 16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
            Continue to Amazon
        </a>
        
        <!-- Security Badge -->
        <div class="security-badge">
            <div class="security-text">
                <svg class="shield-icon" viewBox="0 0 24 24">
                    <path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/>
                </svg>
                Secured by OneLastLink • Trusted affiliate partner
            </div>
        </div>
    </div>
    
    <script>
        let countdown = 3;
        const countdownElement = document.getElementById('countdown');
        
        const timer = setInterval(() => {
            countdown--;
            countdownElement.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(timer);
                window.location.href = '${affiliateUrl}';
            }
        }, 1000);
    </script>
</body>
</html>`;
}

function generateFallbackHTML(asin) {
  const affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=onelastlynx-20`;
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
