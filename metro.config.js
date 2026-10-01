const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Suppress React Native Web warnings in development
if (process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn;
  const originalError = console.error;
  
  console.warn = (...args) => {
    const message = args[0];
    if (typeof message === 'string') {
      // Suppress transform-origin warnings
      if (message.includes('Invalid DOM property') && message.includes('transform-origin')) {
        return;
      }
      // Suppress responder event warnings
      if (message.includes('Unknown event handler property') && 
          (message.includes('onResponderTerminate') || message.includes('onResponderTerminationRequest'))) {
        return;
      }
    }
    originalWarn.apply(console, args);
  };
  
  console.error = (...args) => {
    const message = args[0];
    if (typeof message === 'string') {
      // Suppress transform-origin errors
      if (message.includes('Invalid DOM property') && message.includes('transform-origin')) {
        return;
      }
      // Suppress responder event errors
      if (message.includes('Unknown event handler property') && 
          (message.includes('onResponderTerminate') || message.includes('onResponderTerminationRequest'))) {
        return;
      }
    }
    originalError.apply(console, args);
  };
}

module.exports = config;