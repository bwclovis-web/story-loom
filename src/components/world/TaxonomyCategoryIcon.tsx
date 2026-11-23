import {
  Building2,
  Church,
  Coins,
  Gem,
  Globe2,
  Landmark,
  Languages,
  MapPin,
  Scale,
  ScrollText,
  Sparkles,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { TaxonomyIconKey } from "@/world/taxonomy";
import { getTaxonomyCategory } from "@/world/taxonomy";

const ICONS: Record<TaxonomyIconKey, LucideIcon> = {
  user: User,
  globe: Globe2,
  mapPin: MapPin,
  sparkles: Sparkles,
  users: Users,
  landmark: Landmark,
  church: Church,
  building: Building2,
  languages: Languages,
  scroll: ScrollText,
  coins: Coins,
  cog: Wrench,
  gem: Gem,
  scale: Scale,
};

/** Decorative icon for a World Hub taxonomy category. */
export function TaxonomyCategoryIcon({ categoryId, className }: { categoryId: string; className?: string }) {
  const category = getTaxonomyCategory(categoryId);
  const Icon = category ? ICONS[category.icon] : Landmark;
  return <Icon className={className ?? "world-record-icon"} strokeWidth={1.75} aria-hidden="true" />;
}
