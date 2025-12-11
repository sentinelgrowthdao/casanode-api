#!/bin/bash

CONFIGFILE="/etc/casanode.conf"
LOGFILE="/var/log/casanode/startup.log"
LOGFILE_ROOTLESS="/var/log/casanode/rootless.log"
USER="casanode"
UID_USER=$(id -u "$USER")
FLAGFILE="/opt/$USER/.docker_rootless_installed"
SENTINEL_REMOTE_TAG="ghcr.io/sentinel-official/sentinel-dvpnx:latest"
SENTINEL_LOCAL_TAG="sentinel-dvpnx:latest"

# Create log directory if missing
LOGDIR="$(dirname "$LOGFILE")"
mkdir -p "$LOGDIR"

# Sentinel image (rootless)
ensure_rootless_docker_ready()
{
	echo "Checking rootless Docker readiness…" | tee -a "$LOGFILE"

	# Wait for the rootless daemon to respond to the user socket
	for i in {1..20}; do
		if su - "$USER" -s /bin/bash -c \
			"XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock docker info >/dev/null 2>&1"
		then
			echo "  → Docker rootless is ready." | tee -a "$LOGFILE"
			return 0
		fi
		sleep 0.5
	done

	echo "✗ Docker rootless not ready after timeout." | tee -a "$LOGFILE"
	return 1
}

docker_user()
{
	# Execute a Docker command in the rootless user session with the correct environment
	su - "$USER" -s /bin/bash -c \
		"PATH=\$HOME/.local/bin:/usr/local/sbin:/usr/sbin:/usr/local/bin:/usr/bin:/bin \
		XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR \
		DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock \
		$*"
}

image_exists()
{
	docker_user "docker image inspect \"$1\" >/dev/null 2>&1"
}

ensure_sentinel_image()
{
	echo "Ensuring Sentinel image is present (rootless)…" | tee -a "$LOGFILE"

	# Detect architecture and set tar path
	ARCH=$(uname -m)
	case "$ARCH" in
		x86_64)
			SENTINEL_TAR_PATH="/opt/casanode/docker/sentinel-dvpnx-amd64.tar"
			;;
		aarch64)
			SENTINEL_TAR_PATH="/opt/casanode/docker/sentinel-dvpnx-arm64.tar"
			;;
		*)
			echo "  → Unsupported architecture: $ARCH, skipping image load." | tee -a "$LOGFILE"
			return 0
			;;
	esac

	# Preliminary checks
	if [ ! -f "$SENTINEL_TAR_PATH" ]; then
		echo "  → Tar not found: $SENTINEL_TAR_PATH (skip)" | tee -a "$LOGFILE"
		return 0
	fi

	if ! ensure_rootless_docker_ready; then
		echo "  → Skip image load: docker not ready." | tee -a "$LOGFILE"
		return 1
	fi

	# Load the image if the “remote” tag does not exist locally
	if ! image_exists "$SENTINEL_REMOTE_TAG"; then
		echo "  → Loading image from tar…" | tee -a "$LOGFILE"
		if ! docker_user "docker load -i \"$SENTINEL_TAR_PATH\""; then
			echo "    ✗ docker load failed" | tee -a "$LOGFILE"
			return 1
		fi
	else
		echo "  → Remote tag already present: $SENTINEL_REMOTE_TAG" | tee -a "$LOGFILE"
	fi

	# Tag as “local” if missing
	if ! image_exists "$SENTINEL_LOCAL_TAG"; then
		echo "  → Tagging $SENTINEL_REMOTE_TAG as $SENTINEL_LOCAL_TAG" | tee -a "$LOGFILE"
		if ! docker_user "docker tag \"$SENTINEL_REMOTE_TAG\" \"$SENTINEL_LOCAL_TAG\""; then
			echo "    ✗ docker tag failed" | tee -a "$LOGFILE"
			return 1
		fi
	else
		echo "  → Local tag already present: $SENTINEL_LOCAL_TAG" | tee -a "$LOGFILE"
	fi

	echo "✓ Sentinel image ensured." | tee -a "$LOGFILE"
	return 0
}


# Clear the log file at the start of each execution
> "$LOGFILE"
echo "=== Casanode startup begin ===" | tee -a "$LOGFILE"

sync_clock()
{
	echo "Synchronizing system clock…" | tee -a "$LOGFILE"
	
	if command -v timedatectl >/dev/null 2>&1; then
		# Enable NTP if disabled, then restart the built-in client
		timedatectl set-ntp true 2>>"$LOGFILE"
		systemctl restart systemd-timesyncd.service 2>>"$LOGFILE"
		sleep 2
		timedatectl show -p NTPSynchronized 2>>"$LOGFILE" | tee -a "$LOGFILE"
		return 0
	fi
	
	echo "timedatectl not available, skipping clock synchronization." | tee -a "$LOGFILE"
	return 0
}

sync_clock


# Start the systemd-user instance for casanode
echo "Launching user@$UID_USER.service…" | tee -a "$LOGFILE"
systemctl start user@"$UID_USER".service || {
	echo "✗ Unable to start user@$UID_USER.service" | tee -a "$LOGFILE"
	exit 1
}

# Wait for the D-Bus bus to appear (max 5s)
echo "Waiting for /run/user/$UID_USER/bus…" | tee -a "$LOGFILE"
for i in {1..10}; do
	su - "$USER" -s /bin/bash -c \
	  "XDG_RUNTIME_DIR=/run/user/$UID_USER systemctl --user is-system-running --quiet"
	[ $? -le 1 ] && break   # 0=running, 1=degraded → ok
	sleep 1
done
if ! [ -S "/run/user/$UID_USER/bus" ]; then
	echo "✗ D-Bus bus still missing, aborting." | tee -a "$LOGFILE"; exit 1
fi

# Always export the variable for 'su - casanode' commands
export XDG_RUNTIME_DIR="/run/user/$UID_USER"

# Install Docker rootless if necessary
if [ ! -f "$FLAGFILE" ]; then
	echo "Docker rootless not installed. Installing…" | tee -a "$LOGFILE"
	
	# Stop Docker rootful
	echo "  → Stopping rootful Docker..." | tee -a "$LOGFILE"
	systemctl disable --now docker.service docker.socket &>>"$LOGFILE"
	rm -f /var/run/docker.sock                                 &>>"$LOGFILE"
	echo "  → Rootful Docker stopped." | tee -a "$LOGFILE"
	
	# Enable linger
	loginctl enable-linger "$USER" &>>"$LOGFILE"
	echo "  → Linger enabled for $USER." | tee -a "$LOGFILE"
	
	# Add entries to /etc/subuid and /etc/subgid if they do not already exist
	grep -q "^${USER}:" /etc/subuid  || echo "${USER}:100000:65536" >> /etc/subuid
	grep -q "^${USER}:" /etc/subgid  || echo "${USER}:100000:65536" >> /etc/subgid
	
	# Ensure ownership of .config
	chown -R casanode:casanode /opt/casanode/.config &>>"$LOGFILE"
	
	# Check rootless Docker prerequisites
	echo "  → Checking rootless prerequisites…" | tee -a "$LOGFILE"
	
	# Load nf_tables module as root (instead of sudo modprobe)
	if ! lsmod | grep -q '^nf_tables'; then
		echo "    • Loading nf_tables module as root…" | tee -a "$LOGFILE"
		modprobe nf_tables || {
			echo "      ✗ modprobe nf_tables failed" | tee -a "$LOGFILE"
			exit 1
		}
	fi

	# Install Docker rootless
	echo "  → Calling dockerd-rootless-setuptool.sh…" | tee -a "$LOGFILE"
	su - "$USER" -s /bin/bash -c \
		"PATH=/usr/local/sbin:/usr/sbin:/usr/local/bin:/usr/bin:/bin \
		XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR dockerd-rootless-setuptool.sh install -f" \
		2>&1 | tee "$LOGFILE_ROOTLESS"
	RC=${PIPESTATUS[0]}
	echo "→ install exit code = $RC" | tee -a "$LOGFILE"
	
	if [ $RC -eq 0 ]; then
		echo "  → Enabling rootless Docker service…" | tee -a "$LOGFILE"
		su - "$USER" -s /bin/bash -c \
			"XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR systemctl --user enable --now docker" \
			| tee -a "$LOGFILE"
		touch "$FLAGFILE"
		echo "  ✓ Docker rootless installation successful." | tee -a "$LOGFILE"
		
		echo "  → Ensuring Sentinel image is present…" | tee -a "$LOGFILE"
		ensure_sentinel_image
	else
		echo "✗ Rootless installation failed, will retry on next boot." | tee -a "$LOGFILE"
	fi
else
	echo "Docker rootless already installed." | tee -a "$LOGFILE"
	echo "  → Starting (or restarting) rootless Docker service…" | tee -a "$LOGFILE"
	su - "$USER" -s /bin/bash -c \
		"XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR systemctl --user restart docker" \
		| tee -a "$LOGFILE"
	
	echo "  → Ensuring Sentinel image is present…" | tee -a "$LOGFILE"
	ensure_sentinel_image
fi

# Check if UFW is installed
if ! command -v ufw >/dev/null 2>&1; then
	echo "UFW not installed, skipping firewall configuration." | tee -a "$LOGFILE"
	echo "=== Casanode startup finished ===" | tee -a "$LOGFILE"
	exit 0
fi

# Configure UFW rules if not already configured
UFW_STATUS=$(ufw status | grep -i "Status: active")
if [ -z "$UFW_STATUS" ]
then
	# Load configuration file
	if [ -f "$CONFIGFILE" ]; then
		. "$CONFIGFILE"
    else
        echo "Configuration file $CONFIGFILE not found. Using default values." | tee -a "$LOGFILE"
        API_LISTEN="0.0.0.0:14045"
    fi

    # Extract port from configuration
    API_PORT=$(echo "$API_LISTEN" | cut -d':' -f2)

    echo "Configuring UFW rules..." | tee -a "$LOGFILE"
    ufw default deny incoming | tee -a "$LOGFILE"
    ufw default allow outgoing | tee -a "$LOGFILE"
    ufw allow ssh | tee -a "$LOGFILE"
    ufw allow "$API_PORT" | tee -a "$LOGFILE"
    ufw --force enable | tee -a "$LOGFILE"
    echo "UFW rules configured." | tee -a "$LOGFILE"
else
	echo "UFW is already active." | tee -a "$LOGFILE"
fi


echo "=== Casanode startup finished ===" | tee -a "$LOGFILE"
exit 0
