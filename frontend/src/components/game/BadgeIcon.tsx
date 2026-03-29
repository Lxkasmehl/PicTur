import type { FC } from 'react';
import {
  IconSparkles,
  IconBinoculars,
  IconTrekking,
  IconAward,
  IconCurrentLocation,
  IconMapPin,
  IconPhotoPlus,
  IconFlame,
  IconMailCheck,
  IconBook,
  IconStar,
  IconCrown,
} from '@tabler/icons-react';

type TablerLike = FC<{ size?: number | string; stroke?: number | string }>;

const MAP: Record<string, TablerLike> = {
  IconSparkles,
  IconBinoculars,
  IconTrekking,
  IconAward,
  IconCurrentLocation,
  IconMapPin,
  IconPhotoPlus,
  IconFlame,
  IconMailCheck,
  IconBook,
  IconStar,
  IconCrown,
};

export function BadgeIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Cmp = MAP[name] ?? IconSparkles;
  return <Cmp size={size} stroke={1.5} />;
}
