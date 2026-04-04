/**
 * Expense categories with emoji, keywords (Hindi + English + Hinglish)
 */

const CATEGORIES = {
  GROCERY: {
    id: 'grocery',
    label: 'Grocery & Vegetables',
    emoji: '🛒',
    keywords: [
      'grocery', 'sabzi', 'vegetables', 'sabji', 'kirana', 'ration',
      'dal', 'chawal', 'rice', 'atta', 'flour', 'oil', 'tel',
      'doodh', 'milk', 'paneer', 'dahi', 'curd', 'eggs', 'anda',
      'vegetable market', 'sabzi mandi', 'bigbasket', 'grofers', 'blinkit',
      'zepto', 'instamart', 'swiggy instamart', 'dunzo', 'reliance fresh',
      'dmart', 'd-mart', 'more supermarket', 'spencer', 'nature basket'
    ]
  },
  FOOD: {
    id: 'food',
    label: 'Food & Dining',
    emoji: '🍱',
    keywords: [
      'zomato', 'swiggy', 'restaurant', 'hotel', 'dhaba', 'cafe',
      'food', 'khana', 'lunch', 'dinner', 'breakfast', 'nashta',
      'chai', 'tea', 'coffee', 'juice', 'snacks', 'pizza', 'burger',
      'biryani', 'thali', 'dabba', 'tiffin', 'eat', 'eating', 'dining',
      'canteen', 'mess', 'khane', 'khaya', 'mcdonalds', 'kfc', 'dominos',
      'subway', 'barbeque nation', 'haldiram'
    ]
  },
  TRANSPORT: {
    id: 'transport',
    label: 'Transport',
    emoji: '🚌',
    keywords: [
      'auto', 'rickshaw', 'cab', 'taxi', 'ola', 'uber', 'rapido',
      'petrol', 'diesel', 'fuel', 'bus', 'metro', 'train', 'ticket',
      'parking', 'toll', 'travel', 'transport', 'ride', 'journey',
      'yatra', 'safar', 'irctc', 'redbus', 'ola auto', 'uber auto',
      'rapido bike'
    ]
  },
  HEALTHCARE: {
    id: 'healthcare',
    label: 'Healthcare & Medicine',
    emoji: '💊',
    keywords: [
      'medicine', 'medical', 'doctor', 'hospital', 'clinic', 'pharmacy',
      'dawai', 'dawa', 'dava', 'chemist', 'lab', 'test', 'pathology',
      'apollo pharmacy', 'medplus', '1mg', 'pharmeasy', 'netmeds',
      'consultation', 'checkup', 'health', 'dental', 'eye', 'surgery',
      'operation', 'nursing', 'injection', 'tablet', 'syrup'
    ]
  },
  UTILITIES: {
    id: 'utilities',
    label: 'Utilities',
    emoji: '⚡',
    keywords: [
      'electricity', 'bijli', 'current', 'bescom', 'msedcl', 'bses',
      'tata power', 'adani electricity', 'cesc', 'uppcl', 'tneb',
      'water', 'paani', 'pani', 'gas', 'lpg', 'cylinder', 'indane',
      'hp gas', 'bharat gas', 'water bill', 'maintenance', 'society',
      'broadband', 'wifi', 'internet bill', 'airtel', 'jio fiber',
      'bsnl broadband', 'act fibernet'
    ]
  },
  MOBILE: {
    id: 'mobile',
    label: 'Mobile & Internet',
    emoji: '📱',
    keywords: [
      'recharge', 'mobile', 'phone', 'sim', 'prepaid', 'postpaid',
      'data', 'talktime', 'jio', 'airtel', 'vi', 'vodafone', 'idea',
      'bsnl', 'dth', 'tata sky', 'dish tv', 'sun direct', 'd2h',
      'ott', 'netflix', 'hotstar', 'amazon prime', 'disney', 'zee5',
      'sonyliv', 'spotify', 'youtube premium', 'internet'
    ]
  },
  EDUCATION: {
    id: 'education',
    label: 'Education',
    emoji: '🏫',
    keywords: [
      'school', 'fees', 'college', 'tuition', 'coaching', 'class',
      'books', 'stationery', 'uniform', 'education', 'padhai', 'exam',
      'course', 'institute', 'academy', 'byju', 'unacademy', 'vedantu',
      'upgrad', 'admission', 'hostel', 'mess fees', 'transport fees'
    ]
  },
  HOUSEHOLD: {
    id: 'household',
    label: 'Household',
    emoji: '🏠',
    keywords: [
      'maid', 'bai', 'servant', 'cook', 'driver', 'watchman',
      'salary', 'wages', 'rent', 'kiraya', 'repair', 'plumber',
      'electrician', 'carpenter', 'painter', 'cleaning', 'household',
      'home', 'ghar', 'furniture', 'appliance', 'washing', 'laundry',
      'urban company', 'sulekha', 'amazon'
    ]
  },
  SHOPPING: {
    id: 'shopping',
    label: 'Shopping',
    emoji: '👗',
    keywords: [
      'clothes', 'kapde', 'kapda', 'shirt', 'pant', 'saree', 'kurta',
      'shoes', 'footwear', 'shopping', 'amazon', 'flipkart', 'myntra',
      'ajio', 'nykaa', 'meesho', 'snapdeal', 'fashion', 'accessories',
      'bag', 'watch', 'jewellery', 'cosmetics', 'beauty', 'skincare'
    ]
  },
  ENTERTAINMENT: {
    id: 'entertainment',
    label: 'Entertainment',
    emoji: '🎬',
    keywords: [
      'movie', 'film', 'cinema', 'theatre', 'pvr', 'inox', 'bookmyshow',
      'game', 'sports', 'gym', 'fitness', 'park', 'amusement',
      'concert', 'event', 'show', 'fun', 'outing', 'picnic', 'party'
    ]
  },
  EMI: {
    id: 'emi',
    label: 'EMI & Loans',
    emoji: '💰',
    keywords: [
      'emi', 'loan', 'karz', 'installment', 'credit card', 'credit',
      'hdfc card', 'sbi card', 'icici card', 'axis card', 'kotak card',
      'bajaj finance', 'home loan', 'car loan', 'personal loan',
      'education loan', 'repayment', 'interest', 'principal', 'dues'
    ]
  },
  RELIGIOUS: {
    id: 'religious',
    label: 'Religious & Donations',
    emoji: '🙏',
    keywords: [
      'mandir', 'temple', 'mosque', 'church', 'gurudwara', 'pooja',
      'puja', 'prasad', 'donation', 'daan', 'charity', 'ngo',
      'religious', 'festival', 'diwali', 'eid', 'christmas', 'holi',
      'navratri', 'dakshina', 'pandit', 'priest'
    ]
  },
  TRAVEL: {
    id: 'travel',
    label: 'Travel & Vacation',
    emoji: '✈️',
    keywords: [
      'flight', 'air ticket', 'makemytrip', 'goibibo', 'cleartrip',
      'ixigo', 'hotel booking', 'oyo', 'treebo', 'fabhotels',
      'holiday', 'vacation', 'trip', 'tour', 'travel package',
      'sightseeing', 'visa', 'passport', 'luggage', 'airbnb'
    ]
  },
  OTHER: {
    id: 'other',
    label: 'Other',
    emoji: '📦',
    keywords: []
  }
};

/**
 * Detect category from description/merchant text
 * Returns the category object or OTHER as fallback
 */
function detectCategory(text) {
  if (!text) return CATEGORIES.OTHER;
  const lower = text.toLowerCase();

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (key === 'OTHER') continue;
    for (const kw of cat.keywords) {
      if (lower.includes(kw)) return cat;
    }
  }
  return CATEGORIES.OTHER;
}

/**
 * Get category by id string
 */
function getCategoryById(id) {
  return Object.values(CATEGORIES).find(c => c.id === id) || CATEGORIES.OTHER;
}

/**
 * All category ids for Claude prompt
 */
function getCategoryIds() {
  return Object.values(CATEGORIES).map(c => c.id);
}

module.exports = { CATEGORIES, detectCategory, getCategoryById, getCategoryIds };
