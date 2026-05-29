import { Grid, Text, type GridColProps, type GridProps } from '@mantine/core';
import type { ReactNode } from 'react';
import classes from './SideBySideCompare.module.css';
import { SIDE_BY_SIDE_COMPARE_COL_SPAN } from './sideBySideCompareConstants';

export function SideBySideCompareGrid({ children, gutter, ...props }: GridProps) {
  return (
    <Grid gutter={gutter ?? { base: 'xs', sm: 'md' }} {...props}>
      {children}
    </Grid>
  );
}

export function SideBySideCompareCol({ children, className, ...props }: GridColProps) {
  return (
    <Grid.Col
      span={SIDE_BY_SIDE_COMPARE_COL_SPAN}
      className={[classes.compareCol, className].filter(Boolean).join(' ') || undefined}
      {...props}
    >
      {children}
    </Grid.Col>
  );
}

export function SideBySideCompareLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text
      size='sm'
      c='dimmed'
      mb={4}
      className={[classes.compareLabel, className].filter(Boolean).join(' ') || undefined}
    >
      {children}
    </Text>
  );
}
