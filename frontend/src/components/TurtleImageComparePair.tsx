import { Alert, Box, Image, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconRotate } from '@tabler/icons-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import classes from './SideBySideCompare.module.css';

type ImageDims = { w: number; h: number };

function isLandscapeDims(d: ImageDims): boolean {
  return d.w > d.h * 1.08;
}

export type TurtleImageComparePairProps = {
  leftLabel: ReactNode;
  leftSrc: string;
  rightLabel: ReactNode;
  rightSrc?: string | null;
  rightPlaceholder?: ReactNode;
  tall?: boolean;
};

export function TurtleImageComparePair({
  leftLabel,
  leftSrc,
  rightLabel,
  rightSrc,
  rightPlaceholder,
  tall = false,
}: TurtleImageComparePairProps) {
  const isNarrow = useMediaQuery('(max-width: 576px)');
  const [dims, setDims] = useState<{ left?: ImageDims; right?: ImageDims }>({});

  useEffect(() => {
    setDims({});
  }, [leftSrc, rightSrc]);

  const onImageLoad = useCallback((side: 'left' | 'right') => {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      if (!img.naturalWidth || !img.naturalHeight) return;
      setDims((prev) => ({
        ...prev,
        [side]: { w: img.naturalWidth, h: img.naturalHeight },
      }));
    };
  }, []);

  const anyLandscape = Boolean(
    (dims.left && isLandscapeDims(dims.left)) ||
      (dims.right && isLandscapeDims(dims.right)),
  );

  const stackOnMobile = Boolean(isNarrow && anyLandscape);
  const showRotateHint = Boolean(
    isNarrow && anyLandscape && typeof window !== 'undefined' && window.innerHeight > window.innerWidth,
  );

  const imageClass = [
    tall ? classes.compareImageTall : classes.compareImage,
    stackOnMobile ? classes.compareImageStacked : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rowClass = [classes.compareRow, stackOnMobile ? classes.compareRowStacked : '']
    .filter(Boolean)
    .join(' ');

  return (
    <Box>
      {showRotateHint && (
        <Alert
          icon={<IconRotate size={16} />}
          color='blue'
          variant='light'
          radius='md'
          mb='xs'
          py={6}
        >
          Landscape photos: rotate your phone sideways for a side-by-side view, or compare
          the stacked images below.
        </Alert>
      )}
      <div className={rowClass}>
        <div className={classes.compareCol}>
          <Text size='sm' c='dimmed' mb={4} className={classes.compareLabel}>
            {leftLabel}
          </Text>
          {leftSrc ? (
            <Image
              src={leftSrc}
              alt={typeof leftLabel === 'string' ? leftLabel : 'Uploaded'}
              radius='md'
              className={imageClass}
              onLoad={onImageLoad('left')}
            />
          ) : null}
        </div>
        <div className={classes.compareCol}>
          <Text size='sm' c='dimmed' mb={4} className={classes.compareLabel}>
            {rightLabel}
          </Text>
          {rightSrc ? (
            <Image
              src={rightSrc}
              alt={typeof rightLabel === 'string' ? rightLabel : 'Match'}
              radius='md'
              className={imageClass}
              onLoad={onImageLoad('right')}
            />
          ) : (
            rightPlaceholder ?? (
              <Text size='xs' c='dimmed' mt='sm'>
                Select a match below to compare.
              </Text>
            )
          )}
        </div>
      </div>
    </Box>
  );
}
