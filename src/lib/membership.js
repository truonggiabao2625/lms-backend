const MEMBER_TIER_THRESHOLDS = [
  { minSpent: 15000000, tier: 'DIAMOND', label: 'Kim cuong' },
  { minSpent: 7000000, tier: 'PLATINUM', label: 'Bach kim' },
  { minSpent: 3000000, tier: 'GOLD', label: 'Vang' },
  { minSpent: 1000000, tier: 'SILVER', label: 'Bac' },
  { minSpent: 0, tier: 'BRONZE', label: 'Dong' },
];

export const resolveMemberTier = (totalSpent = 0) => {
  return MEMBER_TIER_THRESHOLDS.find((item) => totalSpent >= item.minSpent) || MEMBER_TIER_THRESHOLDS.at(-1);
};

export const formatCurrencyVnd = (amount = 0) => {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
};

export const getTierWeight = (tier = 'BRONZE') => {
  const index = MEMBER_TIER_THRESHOLDS.findIndex((item) => item.tier === tier);
  return index === -1 ? MEMBER_TIER_THRESHOLDS.length - 1 : MEMBER_TIER_THRESHOLDS.length - 1 - index;
};

export const hasRequiredTier = (currentTier = 'BRONZE', requiredTier = 'BRONZE') => {
  return getTierWeight(currentTier) >= getTierWeight(requiredTier);
};
