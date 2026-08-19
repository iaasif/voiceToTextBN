const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add 'bin' to assetExts so GGML model files (.bin) are handled as bundled assets
if (config.resolver && config.resolver.assetExts) {
  config.resolver.assetExts.push('bin');
}

module.exports = config;
