const https = require('https');
const { parse } = require('node-html-parser');

exports.handler = async (event, context) => {
  let asin = null;
  
  // Check if it's a URL parameter format: /go?url=https://amazon.com/...
  const urlParam = event.queryStringParameters?.url;
  if (urlParam) {
    asin = extractASINFromURL(decodeURIComponent(urlParam));
  } else {
    // Check if it's a direct ASIN format: /go/B09P21T2GC
    const pathAsin = event.path.replace('/go/', '').split('/')[0];
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
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.amazon.com',
      path: `/dp/${asin}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const root = parse(data);
          
          // Extract product title
          let title = '';
          const titleElement = root.querySelector('#productTitle') || 
                              root.querySelector('.product-title') ||
                              root.querySelector('h1');
          if (titleElement) {
            title = titleElement.text.trim();
          }
          
          // Extract product image
          let image = '';
          const imageElement = root.querySelector('#landingImage') ||
                              root.querySelector('.a-dynamic-image') ||
                              root.querySelector('img[data-old-hires]');
          if (imageElement) {
            image = imageElement.getAttribute('src') || 
                   imageElement.getAttribute('data-old-hires') ||
                   imageElement.getAttribute('data-a-dynamic-image');
          }
          
          // Extract price
          let price = '';
          const priceElement = root.querySelector('.a-price .a-offscreen') ||
                              root.querySelector('.a-price-whole');
          if (priceElement) {
            price = priceElement.text.trim();
          }
          
          resolve({
            title: title || `Amazon Product ${asin}`,
            image: image || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX300_QL70_.jpg`,
            price: price,
            asin: asin
          });
          
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(5000, () => {
      req.abort();
      reject(new Error('Request timeout'));
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
    
    <title>${productData.title} - Amazon Deal</title>
    
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            max-width: 500px;
            margin: 0 auto;
            padding: 40px 20px;
            text-align: center;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        .product-image {
            max-width: 250px;
            height: auto;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 8px 16px rgba(0,0,0,0.1);
        }
        .product-title {
            color: #333;
            font-size: 22px;
            font-weight: 600;
            margin-bottom: 15px;
            line-height: 1.3;
        }
        .product-price {
            color: #B12704;
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 20px;
        }
        .redirect-text {
            color: #666;
            margin-bottom: 25px;
        }
        .amazon-button {
            display: inline-block;
            background: linear-gradient(135deg, #ff9900, #ffb84d);
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            transition: transform 0.2s;
            box-shadow: 0 4px 15px rgba(255, 153, 0, 0.3);
        }
        .amazon-button:hover {
            transform: translateY(-2px);
        }
        .countdown {
            font-weight: bold;
            color: #ff9900;
        }
    </style>
</head>
<body>
    <div class="container">
        <img src="${productData.image}" alt="${productData.title}" class="product-image">
        <h1 class="product-title">${productData.title}</h1>
        ${productData.price ? `<div class="product-price">${productData.price}</div>` : ''}
        <p class="redirect-text">
            Redirecting to Amazon in <span id="countdown" class="countdown">3</span> seconds...
        </p>
        <a href="${affiliateUrl}" class="amazon-button">🛒 Shop Now on Amazon</a>
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
  const fallbackImage = `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX300_QL70_.jpg`;
  
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
</head>
<body style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
    <h2>🎯 Redirecting to Amazon...</h2>
    <p>Taking you to your deal...</p>
    <a href="${affiliateUrl}" style="display: inline-block; background: #ff9900; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Amazon</a>
    <script>
        setTimeout(() => {
            window.location.href = '${affiliateUrl}';
        }, 2000);
    </script>
</body>
</html>`;
}