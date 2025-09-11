import { Command } from 'commander';
import {
	daemonCommand,
	checkInstallationCommand,
	dockerCommand,
	nodeCommand,
	walletCommand,
} from '@commands/index';
import {
	initSentry,
} from '@utils/sentry';
import { Logger } from './utils/logger';

// Global variable for the base directory
process.env.BASE_DIR = process.cwd();

// Initialize Sentry
initSentry();
// Finish the transaction on exit
process.on('exit', () =>
{
	Logger.info('Application exiting...');
});
// Handle uncaught exceptions
process.on('SIGINT', () =>
{
	Logger.info('Application exiting... (SIGINT)');
	process.exit(0);
});

// Create a new program and set program information
const program = new Command();
program.name('casanode')
	.description('CLI for managing Casanode node operations via REST APIs')
	.version('1.0.0');

// Display help information
program.command('help')
	.description('Display help information')
	.action(() => program.help());

// Run daemon process
program.command('daemon')
	.description('Run the daemon process')
	.action(() => { daemonCommand(); });

// Check installation
program.command('check-installation')
	.description('Check the installation of the casanode and its dependencies')
	.action((argv) => checkInstallationCommand(argv));

// Docker commands
program.command('docker')
	.description('Docker commands')
	.option('-p, --pull', 'Pull the Casanode Docker image')
	.option('-ri, --remove-images', 'Remove all Docker images')
	.option('-s, --start', 'Start the Casanode Docker container')
	.option('-t, --stop', 'Stop the Casanode Docker container')
	.option('-r, --restart', 'Restart the Casanode Docker container')
	.option('-x, --remove', 'Remove the Casanode Docker container')
	.option('-st, --status', 'Display the status of the Casanode Docker container')
	.option('-l, --logs', 'Display the logs of the Casanode Docker container')
	.action((argv) => dockerCommand(argv));

// Node commands
program.command('node')
	.description('Node commands')
	.option('-s, --show-config', 'Show the node configuration')
	.option('-c, --config', 'Generate the node configuration')
	.option('-v, --vpn', 'Generate the VPN configuration')
	.action((argv) => nodeCommand(argv));

// Wallet commands
program.command('wallet')
	.description('Manage the wallet')
	.option('-b, --balance', 'Display the wallet balance')
	.option('-a, --addresses', 'Load the wallet addresses')
	.option('-c, --create', 'Create a new wallet')
	.option('-r, --recover', 'Recover an existing wallet')
	.option('-rm, --remove', 'Remove the wallet')
	.option('-p, --passphrase <passphrase>', 'Passphrase for the wallet')
	.option('-m, --mnemonic <mnemonic>', 'Mnemonic for wallet recovery (only for recover)')
	.action((argv) => walletCommand(argv));

// If no command is provided, run the daemon process
program.action(() => { daemonCommand(); });

// Parse command line arguments
program.parse(process.argv);
