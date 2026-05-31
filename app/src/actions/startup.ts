import { exec } from 'child_process';
import { promisify } from 'util';

import { Logger } from '@utils/logger';
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
	
	// Load wallet informations
	await walletLoadAddresses(passphrase);

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
