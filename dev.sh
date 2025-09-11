#!/bin/bash

echo "#############################################"
echo "Script used to install the necessary dependencies for the project"
echo "#############################################"

# Install the necessary dependencies
echo "Installing the necessary dependencies"
sudo apt update && sudo apt upgrade -y
sudo sudo apt install build-essential -y

# Install Node.js
echo "Installing Node.js"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo apt install libudev-dev

# Make log directory
echo "Creating log directory"
sudo mkdir -p /var/log/casanode
sudo chown -R $USER: /var/log/casanode

# Make casanode config file
echo "Creating casanode config file"
sudo touch "/etc/casanode.conf"
sudo sudo chown -R $USER: /etc/casanode.conf

# Install dvpn-node-manager
echo "deb http://ppa.launchpad.net/foxinou/dvpn-node-manager/ubuntu jammy main" | sudo tee -a /etc/apt/sources.list
echo "deb-src http://ppa.launchpad.net/foxinou/dvpn-node-manager/ubuntu jammy main" | sudo tee -a /etc/apt/sources.list
gpg --keyserver keyserver.ubuntu.com --recv-keys 1E4DCBDC436F95468F1FEB793B604A1F5EE3D8E5 && gpg --export 1E4DCBDC436F95468F1FEB793B604A1F5EE3D8E5 | sudo tee /etc/apt/trusted.gpg.d/foxinou_dvpn-node-manager.gpg > /dev/null
sudo apt update
sudo apt install -y dvpn-node-manager
