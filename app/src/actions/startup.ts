import { exec } from 'child_process';
import { promisify } from 'util';

import { Logger } from '@utils/logger';
import { checkImageAvailability, imagePull } from '@utils/docker';
import nodeManager from '@utils/node';
import { walletLoadAddresses } from '@utils/node';
import { syncConfiguredNatMappings } from '@utils/nat';

// Promisify the exec function
const execPromise = promisify(exec);

/**
 * Loading node informations
 * @returns Promise<boolean>
 */
export const loadingNodeInformations = async (): Promise<boolean> =>
{
	Logger.info('Loading node informations.');

	// Reload local configuration before publishing desired UPnP mappings
	nodeManager.loadNodeConfig();

	// Ensure the node image exists before trying to read wallet data from it
	const nodeImageAvailable = await ensureNodeImageAvailable();
	if (!nodeImageAvailable)
		Logger.info('Continuing startup without wallet data because the Docker image is unavailable.');
	
	// Load the node location
	await nodeManager.refreshNodeLocation();
	
	// If the passphrase is unavailable
	if (!nodeManager.passphraseAvailable())
	{
		await syncConfiguredNatMappings(nodeManager.getConfig());
		Logger.info('Passphrase required to load wallet informations.');
		return true;
	}
	
	// Get the wallet passphrase stored in the configuration
	const passphrase = nodeManager.getConfig().walletPassphrase;
	
	// Load wallet informations when the node image is available
	if (nodeImageAvailable)
	{
		try
		{
			await walletLoadAddresses(passphrase);
		}
		catch (error)
		{
			Logger.error(`Failed to load wallet informations during startup: ${String(error)}`);
		}
	}

	// Synchronize desired UPnP mappings from the current node configuration
	await syncConfiguredNatMappings(nodeManager.getConfig());
	
	return true;
};

/**
 * Loading system informations
 * @returns Promise<boolean>
 */
export const loadingSystemInformations = async (): Promise<boolean> =>
{
	Logger.info('Loading system informations.');
	
	// Initialize the node uptime
	nodeManager.setSystemUptime(Math.floor(Date.now() / 1000));
	
	// Initialize the system information
	nodeManager.setSystemOs(`${await runCommand('lsb_release -is')} ${await runCommand('lsb_release -rs')}`);
	nodeManager.setSystemKernel(`${await runCommand('uname -r')}`);
	nodeManager.setSystemArch(`${await runCommand('uname -m')}`);
	
	return true;
};

/**
 * Run a command asynchronously
 * @param command string
 * @returns string
 */
async function runCommand(command: string): Promise<string>
{
	const { stdout } = await execPromise(command);
	return stdout.trim() || '';
}

/**
 * Ensure the node Docker image exists locally.
 * If it is missing, try to pull it but do not block daemon startup on failure.
 * @returns Promise<boolean>
 */
async function ensureNodeImageAvailable(): Promise<boolean>
{
	const imageAvailable = await checkImageAvailability();
	if (imageAvailable)
		return true;

	Logger.info('Docker image sentinel-dvpnx:latest is missing, attempting to pull it.');
	const pullResult = await imagePull();
	if (pullResult)
		return true;

	Logger.error('Docker image sentinel-dvpnx:latest is still unavailable after pull attempt.');
	return false;
}
