#!/bin/bash

# Check if docker-compose.build.yml exists
if [ ! -f docker-compose.build.yml ]; then
	echo "docker-compose.build.yml not found!"
	exit 1
fi

# Run the Docker container with the specified image
docker compose --file "docker-compose.build.yml" run --rm -it --name casanode-api-deb ubuntu /bin/bash