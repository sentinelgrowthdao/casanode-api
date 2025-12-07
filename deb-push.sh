#!/bin/bash
set -e

# Configuration
PACKAGE_DIR="package"
DEB_DIR="$PACKAGE_DIR/dist"
REPO_URL="https://github.com/sentinelgrowthdao/casanode-api.git"
GH_PAGES_BRANCH="gh-pages"
TEMP_DIR="gh-pages-temp"

# APT repository structure in the gh-pages branch:
POOL_DIR="pool/main"
# Directories for metadata for each architecture:
DIST_APT_DIR_ARMHF="dists/stable/main/binary-armhf"
DIST_APT_DIR_AMD64="dists/stable/main/binary-amd64"
DIST_APT_DIR_ARM64="dists/stable/main/binary-arm64"

# Find all .deb files in the DEB_DIR
shopt -s nullglob  # If no .deb files are found, the glob expands to nothing
deb_files=("$DEB_DIR"/*.deb)

if [ ${#deb_files[@]} -eq 0 ]; then
    echo "No .deb files found in $DEB_DIR."
    exit 1
fi

echo "Found the following .deb files in $DEB_DIR:"
for file in "${deb_files[@]}"; do
    echo " - $(basename "$file")"
done

# Clone the gh-pages branch into a temporary directory
rm -rf "$TEMP_DIR"  # Remove TEMP_DIR if it already exists
echo "Cloning the gh-pages branch..."
git clone --branch "$GH_PAGES_BRANCH" "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"

# Ensure necessary directories exist in the gh-pages branch
mkdir -p "$POOL_DIR"
mkdir -p "$DIST_APT_DIR_ARMHF"
mkdir -p "$DIST_APT_DIR_AMD64"
mkdir -p "$DIST_APT_DIR_ARM64"

# Copy all .deb files from package/dist to pool/main/
# From the temporary directory, the .deb files are located at "../package/dist/"
echo "Copying .deb files into the APT pool..."
for file in "${deb_files[@]}"; do
    cp "../$DEB_DIR/$(basename "$file")" "$POOL_DIR/"
done

# Generate the APT repository metadata for each architecture
echo "Generating Packages file for armhf..."
dpkg-scanpackages -a armhf "$POOL_DIR" /dev/null > "$DIST_APT_DIR_ARMHF/Packages"
gzip -9c "$DIST_APT_DIR_ARMHF/Packages" > "$DIST_APT_DIR_ARMHF/Packages.gz"

echo "Generating Packages file for amd64..."
dpkg-scanpackages -a amd64 "$POOL_DIR" /dev/null > "$DIST_APT_DIR_AMD64/Packages"
gzip -9c "$DIST_APT_DIR_AMD64/Packages" > "$DIST_APT_DIR_AMD64/Packages.gz"

echo "Generating Packages file for arm64..."
dpkg-scanpackages -a arm64 "$POOL_DIR" /dev/null > "$DIST_APT_DIR_ARM64/Packages"
gzip -9c "$DIST_APT_DIR_ARM64/Packages" > "$DIST_APT_DIR_ARM64/Packages.gz"

# Commit and push the changes
echo "Committing and pushing changes to the gh-pages branch..."
git add "$POOL_DIR/" "$DIST_APT_DIR_ARMHF/Packages"* "$DIST_APT_DIR_AMD64/Packages"* "$DIST_APT_DIR_ARM64/Packages"*
commit_message="Update APT repository with new package(s):"
for file in "${deb_files[@]}"; do
    commit_message+=" $(basename "$file")"
done
git commit -m "$commit_message"
git push origin "$GH_PAGES_BRANCH"

# Cleanup
cd ..
rm -rf "$TEMP_DIR"
rm -f "$DEB_DIR"/*.deb

echo "APT repository updated successfully."
