#!/bin/bash
set -e

echo "========================================"
echo "  PulsarTeam — Post-deployment"
echo "========================================"

echo ""
echo "🔍 Checking stack services..."
docker stack services pulsarteam 2>/dev/null || echo "   Stack 'pulsarteam' not found — deploy with: docker stack deploy -c docker-compose.swarm.yml pulsarteam"

echo ""
echo "🌐 Application should be available at:"
echo "   https://swarm.methodinfo.fr"
echo ""
echo "   Login with the credentials configured in your .env file"
echo ""
echo "✅ Post-deployment complete"
echo "========================================"
