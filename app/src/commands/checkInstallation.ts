import { checkInstallation, type InstallationCheck } from '@actions/index';

export const checkInstallationCommand = async (_options: any) =>
{
	// Execute the checkInstallation function
	const status : InstallationCheck = await checkInstallation();
	
	// Display the results
	console.log('Installation status:');
	console.log(`Docker image: ${status.image ? 'available' : 'not available'}`);
	console.log(`Docker container: ${status.containerExists ? 'exists' : 'does not exist'}`);
	console.log(`Node config: ${status.nodeConfig ? 'available' : 'not available'}`);
	console.log(`Certificate key: ${status.certificateKey ? 'available' : 'not available'}`);
	console.log(`Wallet: ${status.wallet ? 'available' : 'not available'}`);
};
