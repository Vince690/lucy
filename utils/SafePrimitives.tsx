import React from 'react';
import {
  View as RNView,
  Pressable as RNPressable,
  Text,
  ViewProps,
  PressableProps,
} from 'react-native';

// Active le logging pour repérer l'endroit fautif pendant la preview Web
const DEBUG_LOG = true;

function logOffender(value: unknown) {
  if (!DEBUG_LOG) return;
  const sample =
    typeof value === 'string' ? value.slice(0, 80) : String(value).slice(0, 80);
  // eslint-disable-next-line no-console
  console.error(
    `[TextGuard] Raw text under a View-like container → "${sample}"`,
    new Error().stack?.split('\n').slice(0, 6).join('\n')
  );
}

function guard(children: React.ReactNode): React.ReactNode {
  if (children == null || children === false) return null;

  if (typeof children === 'string' || typeof children === 'number') {
    logOffender(children);
    return <Text>{String(children)}</Text>;
  }

  if (Array.isArray(children)) {
    return children.map((c, i) => <React.Fragment key={i}>{guard(c)}</React.Fragment>);
  }

  if (React.isValidElement(children)) {
    // Pas de recursion profonde : on veut juste empêcher le crash
    // et obtenir une stack pour retrouver la source.
    return children;
  }

  logOffender(children);
  return <Text>{String(children)}</Text>;
}

export function View(props: ViewProps & { children?: React.ReactNode }) {
  const { children, ...rest } = props;
  return <RNView {...rest}>{guard(children)}</RNView>;
}

export function Pressable(props: PressableProps & { children?: React.ReactNode }) {
  const { children, ...rest } = props;
  return <RNPressable {...rest}>{guard(children)}</RNPressable>;
}