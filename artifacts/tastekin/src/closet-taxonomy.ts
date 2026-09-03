// My Things (KIN) closet taxonomy. Every `value` here must match the
// backend token in lib/db/src/schema/closet.ts exactly — these are the
// only values the API accepts. `label` is English display text only and
// may change freely without ever touching the stored value.

export type TaxonomyOption = { value: string; label: string };

export const CLOSET_ITEM_TYPES: TaxonomyOption[] = [
  { value: 't_shirt', label: 'T-Shirt' },
  { value: 'shirt', label: 'Shirt' },
  { value: 'polo', label: 'Polo' },
  { value: 'blouse', label: 'Blouse' },
  { value: 'top', label: 'Top' },
  { value: 'sweater', label: 'Sweater' },
  { value: 'hoodie', label: 'Hoodie' },
  { value: 'pants', label: 'Pants' },
  { value: 'jeans', label: 'Jeans' },
  { value: 'shorts', label: 'Shorts' },
  { value: 'skirt', label: 'Skirt' },
  { value: 'dress', label: 'Dress' },
  { value: 'jacket', label: 'Jacket' },
  { value: 'coat', label: 'Coat' },
  { value: 'blazer', label: 'Blazer' },
  { value: 'suit', label: 'Suit' },
  { value: 'sneakers', label: 'Sneakers' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'boots', label: 'Boots' },
  { value: 'sandals', label: 'Sandals' },
  { value: 'heels', label: 'Heels' },
  { value: 'bag', label: 'Bag' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' },
];

export const CLOSET_PRIMARY_COLORS: TaxonomyOption[] = [
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'gray', label: 'Gray' },
  { value: 'beige', label: 'Beige' },
  { value: 'cream', label: 'Cream' },
  { value: 'brown', label: 'Brown' },
  { value: 'navy', label: 'Navy' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'olive', label: 'Olive' },
  { value: 'red', label: 'Red' },
  { value: 'burgundy', label: 'Burgundy' },
  { value: 'orange', label: 'Orange' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'multicolor', label: 'Multicolor' },
];

export const CLOSET_STYLES: TaxonomyOption[] = [
  { value: 'casual', label: 'Casual' },
  { value: 'smart_casual', label: 'Smart Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'classic', label: 'Classic' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'streetwear', label: 'Streetwear' },
  { value: 'sporty', label: 'Sporty' },
  { value: 'business', label: 'Business' },
  { value: 'evening', label: 'Evening' },
  { value: 'bohemian', label: 'Bohemian' },
];

export const CLOSET_OCCASIONS: TaxonomyOption[] = [
  { value: 'everyday', label: 'Everyday' },
  { value: 'work', label: 'Work' },
  { value: 'formal_event', label: 'Formal Event' },
  { value: 'evening', label: 'Evening' },
  { value: 'travel', label: 'Travel' },
  { value: 'sport', label: 'Sport' },
  { value: 'home', label: 'Home' },
];

export const CLOSET_SEASONS: TaxonomyOption[] = [
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'autumn', label: 'Autumn' },
  { value: 'winter', label: 'Winter' },
  { value: 'all_season', label: 'All Season' },
];

export function closetTaxonomyLabel(options: TaxonomyOption[], value: string | null | undefined): string {
  if (!value) return '';
  return options.find((option) => option.value === value)?.label || value;
}
