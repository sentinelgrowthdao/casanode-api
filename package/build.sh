#!/bin/bash
set -e

# Directories used
DEB_DIR="/package/deb"					# Files intended for the .deb
DIST_DIR="/package/dist"				# Where the generated .deb will be placed
APP_DIR="/app/"							# Node.js sources in TypeScript
TARGET_APP_DIR="$DEB_DIR/opt/casanode"	# Destination of the compiled application in the .deb

echo "=== Cleaning previous compiled application files in $TARGET_APP_DIR (preserving startup scripts, updater and nginx configs) ==="
# We keep startup.sh, updater.sh and the nginx configuration directory (nginx) so that
# custom/admin edited reverse proxy config isn't lost between builds.
find "$TARGET_APP_DIR" -mindepth 1 \
	! -name 'startup.sh' \
	! -name 'updater.sh' \
	! -path "$TARGET_APP_DIR/nginx" \
	! -path "$TARGET_APP_DIR/nginx/*" \
	-delete

echo "=== Creating log directory $DEB_DIR/var/log/casanode if it does not exist ==="
mkdir -p "$DEB_DIR/var/log/casanode"

echo "=== Building Node.js application in $APP_DIR ==="
cd "$APP_DIR"
npm install
npm run build

echo "=== Copying compiled application files from $APP_DIR/dist to $TARGET_APP_DIR ==="
mkdir -p "$TARGET_APP_DIR/app"
cp -r "$APP_DIR/dist/"* "$TARGET_APP_DIR/app/"
cp -r "$APP_DIR/web/" "$TARGET_APP_DIR/web/"

echo "=== Copying package.json and package-lock.json ==="
cp "$APP_DIR/package.json" "$TARGET_APP_DIR/app/"
cp "$APP_DIR/package-lock.json" "$TARGET_APP_DIR/app/"

echo "=== Changing the start script in package.json ==="
sed -i '/"scripts": {/,/},/c\  "scripts": {\n    "start": "node ./main.js"\n  },' $TARGET_APP_DIR/app/package.json

cd "$PROJECT_ROOT"

echo "=== Setting permissions on package files ==="
# DEBIAN scripts must be executable
chmod 755 "$DEB_DIR/DEBIAN/postinst"
chmod 755 "$DEB_DIR/DEBIAN/prerm"
chmod 755 "$DEB_DIR/DEBIAN/postrm"
# For example, the systemd file and config must be read-only
chmod 644 "$DEB_DIR/etc/systemd/system/casanode.service"
chmod 644 "$DEB_DIR/etc/systemd/system/casanode-startup.service"
chmod 644 "$DEB_DIR/etc/casanode.conf"
chmod 644 "$DEB_DIR/etc/logrotate.d/casanode"
# Ensure the startup.sh script is executable
chmod +x "$TARGET_APP_DIR/startup.sh"
chmod +x "$TARGET_APP_DIR/updater.sh"

# Save the current user
CURRENT_USER=$(stat -c '%U' "$DEB_DIR")

# Change the owner of all package files to comply with Debian standards
chown -R root:root "$DEB_DIR"

# Variables for package creation
PACKAGE_NAME="casanode-api"
VERSION=$(grep '"version"' "$APP_DIR/package.json" | sed -E 's/.*"version": "([^"]+)".*/\1/')
ARCHITECTURE="all"  # Since the project is in Node.js, we can use "all"
DEB_FILE="$DIST_DIR/${PACKAGE_NAME}_${VERSION}_${ARCHITECTURE}.deb"

mkdir -p "$DIST_DIR"

# Temporary modification of the control file for the alpha version
echo "=== Modifying DEBIAN/control file to set alpha version ==="
CONTROL_FILE="$DEB_DIR/DEBIAN/control"
BACKUP_CONTROL_FILE="$DEB_DIR/DEBIAN/control.bak"
# Backup the original control file
cp "$CONTROL_FILE" "$BACKUP_CONTROL_FILE"
# Replace the Version field with the package version
sed -i "s/^Version: .*/Version: ${VERSION}/" "$CONTROL_FILE"
echo "Control file modified: $(grep ^Version: "$CONTROL_FILE")"
# Replace the version parameter in casanode.conf
sed -i "s/^version=.*/version=${VERSION}/" "$DEB_DIR/etc/casanode.conf"

echo "=== Building .deb package ==="
dpkg-deb --build --root-owner-group "$DEB_DIR" "$DEB_FILE"

# Restoring the original control file
echo "=== Restoring original control file ==="
mv "$BACKUP_CONTROL_FILE" "$CONTROL_FILE"

echo "=== Restoring permissions to $CURRENT_USER on the package directory ==="
chown -R "$CURRENT_USER:$CURRENT_USER" "$DEB_DIR"

echo -e "\e[32mPackage built successfully: $DEB_FILE\e[0m"
