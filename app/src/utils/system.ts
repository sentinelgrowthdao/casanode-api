import { exec } from 'child_process';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '@utils/logger';
import { imagePull, containerStop, imagesRemove, containerRemove } from '@utils/docker';
import nodeManager from '@utils/node';
import config, { resetConfiguration, refreshNetworkConfiguration } from '@utils/configuration';

/**
 * Promise-based function to update the system
 * @returns Promise<void>
 */
export async function updateSystem(): Promise<void>
{
	return new Promise(async (resolve, reject) =>
	{
		try
		{
			// Pull the Docker image using imagePull from docker utils
			Logger.info('Pulling the Casanode Docker image...');
			const pullResult = await imagePull();
			// Check if the image was pulled successfully
			if (pullResult)
			{
				Logger.info('Casanode Docker image pulled successfully');
			}
			else
			{
				Logger.error('Failed to pull the Casanode Docker image');
				reject('Failed to pull the Casanode Docker image');
				return;
			}
			
			// Log file path
			const logFilePath = path.join(config?.LOG_DIR || '/var/log/casanode/', 'updater.log');
			// Systemd command to run the updater script
			const command = `sudo systemd-run --unit=casanode-updater --description="Updating Casanode" --service-type=simple /opt/casanode/updater.sh > ${logFilePath} 2>&1`;
			// Execute system update commands here
			exec(command, (error, _stdout, _stderr) =>
			{
				if (error)
				{
					Logger.error(`Error updating system: ${error}`);
					reject(error);
				}
				else
				{
					Logger.info('System update command executed successfully');
					resolve();
				}
			});
		}
		catch (error)
		{
			Logger.error(`Error updating system: ${error}`);
			reject(error);
		}
	});
}

/**
 * Promise-based function to update Sentinel
 * @returns Promise<void>
 */
export async function updateSentinel(): Promise<void>
{
	return new Promise(async (resolve, reject) =>
	{
		try
		{
			refreshNetworkConfiguration();
			// Execute Sentinel update commands here
			exec('sudo apt update && sudo apt upgrade -y', (error, _stdout, _stderr) =>
			{
				if (error)
				{
					Logger.error(`Error updating Sentinel: ${error}`);
					reject(error);
				}
				else
				{
					Logger.info('Sentinel update command executed successfully');
					resolve();
				}
			});
		}
		catch (error)
		{
			Logger.error(`Error updating Sentinel: ${error}`);
			reject(error);
		}
	});
}

/**
 * Promise-based function to reset the system
 * @returns Promise<void>
 */
export async function resetSystem(): Promise<void>
{
	return new Promise(async (resolve, reject) =>
	{
		try
		{
			// Stop Docker container
			Logger.info('Stopping Casanode Docker container...');
			const stopResult = await containerStop();
			if (!stopResult)
			{
				Logger.error('Failed to stop Casanode Docker container.');
				reject('Failed to stop Casanode Docker container.');
				return;
			}
			
			// Remove container
			Logger.info('Removing Casanode Docker container...');
			const containerRemoveResult = await containerRemove();
			if (!containerRemoveResult)
			{
				Logger.error('Failed to remove Casanode Docker container.');
				reject('Failed to remove Casanode Docker container.');
				return;
			}
			
			// Get wallet passphrase
			const passphrase = nodeManager.getConfig().walletPassphrase;
			
			// Check if the wallet exists
			Logger.info('Checking if the wallet exists...');
			const walletExistsResult = await nodeManager.walletExists(passphrase);
			
			// If the wallet exists
			if (walletExistsResult)
			{
				// Remove Wallet
				Logger.info('Removing the wallet...');
				const walletRemoveResult = await nodeManager.walletRemove(passphrase);
				if (!walletRemoveResult)
				{
					Logger.error('Failed to remove the wallet.');
					// reject('Failed to remove the wallet.');
					// return;
				}
			}
			
			// Remove Docker images
			Logger.info('Removing all Docker images...');
			const removeImagesResult = await imagesRemove();
			if (!removeImagesResult)
			{
				Logger.error('Failed to remove all Docker images.');
				// reject('Failed to remove all Docker images.');
				// return;
			}
			
			// Determine user's home directory
			const userHomeDir = os.homedir();
			
			// Delete specific directory for Sentinel configuration
			const sentinelNodeDir = config?.CONFIG_DIR || `${userHomeDir}/.sentinel-dvpnx`;
			Logger.info(`Deleting directory: ${sentinelNodeDir}`);
			await fs.rm(sentinelNodeDir, { recursive: true });
			
			// Reset the node configuration
			nodeManager.resetNodeConfig();
			
			// Reload remote Ip and Location
			await nodeManager.refreshNodeLocation();
			
			// Reset configuration
			resetConfiguration();
			
			// Resolve the promise when all operations are completed successfully
			resolve();
		}
		catch (error)
		{
			Logger.error(`Error resetting system: ${error}`);
			reject(error);
		}
	});
}

/**
 * Promise-based function to shut down the system
 * @returns Promise<void>
 */
export async function shutdownSystem(): Promise<void>
{
	return new Promise((resolve, reject) =>
	{
		exec('sudo shutdown -h now', (error, _stdout, _stderr) =>
		{
			if (error)
				reject(`Error shutting down system: ${error.message}`);
			else
				resolve();
		});
	});
}

/**
 * Promise-based function to reboot the system
 * @returns Promise<void>
 */
export async function rebootSystem(): Promise<void>
{
	return new Promise((resolve, reject) =>
	{
		exec('sudo shutdown -r now', (error, _stdout, _stderr) =>
		{
			if (error)
				reject(`Error rebooting system: ${error.message}`);
			else
				resolve();
		});
	});
}
