export const formatCurrency = (amount: number | string | undefined | null): string => {
  if (amount === undefined || amount === null) return 'RM 0.00';
  
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numericAmount)) return 'RM 0.00';

  // For exactly "RM 1,234.56" output, some browsers format en-MY MYR as "RM1,234.56"
  // so we'll enforce the space explicitly to match user request.
  const formatted = new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    currencyDisplay: 'code', // outputs "MYR 1,250.00"
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numericAmount);
  
  return formatted.replace('MYR', 'RM').trim();
};
