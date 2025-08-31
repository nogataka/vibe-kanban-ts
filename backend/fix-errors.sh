#!/bin/bash

# Fix unused imports
sed -i '' '/^import.*logger.*from.*\.\.\/utils\/logger/d' src/executors/base.ts
sed -i '' '/^import.*DatabaseService.*from.*\.\.\/services\/database/d' src/routes/config.ts
sed -i '' '/^import.*path.*from.*path/d' src/services/deployment.ts
sed -i '' '/^import.*uuidv4.*from.*uuid/d' src/mcp/server.ts
sed -i '' '/^import.*Request.*Response.*from.*express/s/Request, Response/Express/' src/routes/index.ts

# Fix unused parameters with underscore prefix
sed -i '' 's/(req: Request,/_req: Request,/g' src/routes/health.ts
sed -i '' 's/(req: Request,/_req: Request,/g' src/routes/config.ts

# Fix type assertions for API responses
sed -i '' 's/const data = await response.json()/const data = await response.json() as any/g' src/executors/*.ts

echo "Fixes applied!"