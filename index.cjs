const manifest = require("./topogram-extractor.json");

const expressExtractor = {
  id: "api.express-package",
  track: "api",
  detect() {
    return { score: 0, reasons: [] };
  },
  extract() {
    return {
      findings: [],
      candidates: {
        capabilities: [],
        routes: [],
        stacks: []
      },
      diagnostics: []
    };
  }
};

module.exports = {
  manifest,
  extractors: [expressExtractor]
};

