import Docker from 'dockerode';
import { Readable, PassThrough } from 'stream';
import { nodeConfig, type NodeConfigData } from '@utils/node';
import config from './configuration';
import { getDockerDefaultSocketPath } from './configuration';
import { Logger } from './logger';

class DockerManager
{
	private static instance: DockerManager;
	private docker: Docker;
	
	// Passphrase error messages
	public static passphraseErrors = [
		'incorrect passphrase',
		'too many failed passphrase attempts',
		'password must be at least 8 characters',
	];
	
	private constructor()
	{
		this.docker = new Docker({ socketPath: config.DOCKER_SOCKET || getDockerDefaultSocketPath() });
	}
	
	/**
	 * Get instance of DockerManager
	 * @returns DockerManager
	 */
	public static getInstance(): DockerManager
	{
		if (!DockerManager.instance)
			DockerManager.instance = new DockerManager();
		
		return DockerManager.instance;
	}
	
	/**
	 * Check if the Docker image is available locally
	 * @return boolean
	 */
	public async checkImageAvailability(): Promise<boolean>
	{
		try
		{
			const imageName = config.DOCKER_IMAGE_NAME;
			const images = await this.docker.listImages();
			const imageExists = images.some((image) => image.RepoTags && image.RepoTags.includes(imageName));
			return imageExists;
		}
		catch (err)
		{
			Logger.error(`Error while checking Docker image:\n${err?.toString()}`);
		}
		
		return false;
	}
	
	/**
	 * Inspect the Docker container
	 * @returns Docker.ContainerInspectInfo | null
	 */
	public async inspectDockerContainer(): Promise<Docker.ContainerInspectInfo | null>
	{
		try
		{
			const containerName = config.DOCKER_CONTAINER_NAME;
			const containerInfo = await this.docker.getContainer(containerName).inspect();
			return containerInfo;
		}
		catch (err)
		{
			Logger.error(`Error while inspecting Docker container ${config.DOCKER_CONTAINER_NAME}:\n${err?.toString()}`);
		}
		
		return null;
	}
	
	/**
	 * Pull Docker image
	 * @returns boolean
	 */
	public async imagePull(): Promise<boolean>
	{
		try
		{
			const imageName = config.DOCKER_IMAGE_NAME;
			const containerName = config.DOCKER_CONTAINER_NAME;
			
			Logger.info(`Pulling Docker image ${imageName}`);
			await new Promise<void>((resolve, reject) =>
			{
				// Pull Docker image
				this.docker.pull(imageName, (err: any, stream: any) =>
				{
					if (err)
						return reject(err);
					// Follow progress of pulling image
					this.docker.modem.followProgress(stream, (err, _res) =>
					{
						if (err)
							return reject(err);
						
						resolve();
					});
				});
			});
			Logger.info(`Docker image ${imageName} pulled successfully`);
			
			// Tagging the image
			const image = this.docker.getImage(imageName);
			await image.tag({ repo: containerName });
			
			Logger.info(`Docker image ${imageName} tagged as ${containerName} successfully`);
			
			return true;
		}
		catch (err)
		{
			Logger.error(`Error while pulling Docker image ${config.DOCKER_IMAGE_NAME}:\n${err?.toString()}`);
		}
		
		return false;
	}
	
	/**
	 * Remove Docker image
	 * @param imageName string
	 * @returns boolean
	 */
	public async removeImage(imageName: string): Promise<boolean>
	{
		try
		{
			const image: Docker.Image = this.docker.getImage(imageName);
			Logger.info(`Removing Docker image ${imageName}...`);
			await image.remove({ force: true });
			Logger.info(`Docker image ${imageName} removed successfully.`);
			return true;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to remove Docker image ${imageName}: ${err.message}`);
			else
				Logger.error(`Failed to remove Docker image ${imageName}: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Remove Docker images
	 * @returns boolean
	 */
	public async imagesRemove(): Promise<boolean>
	{
		try
		{
			const imageName = config.DOCKER_IMAGE_NAME;
			const containerName = config.DOCKER_CONTAINER_NAME;
			
			const removeOriginal = await this.removeImage(imageName);
			const removeTagged = await this.removeImage(containerName);
			
			return removeOriginal && removeTagged;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to remove Docker images: ${err.message}`);
			else
				Logger.error(`Failed to remove Docker images: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Start Docker container
	 * @param walletPassphrase string|null
	 * @returns boolean
	 */
	public async containerStart(): Promise<boolean>
	{
		const configNode : NodeConfigData = nodeConfig();
		
		try
		{
			const containerList = await this.docker.listContainers({ all: true });
			const containerExists = containerList.some((container) => container.Names.includes(`/${config.DOCKER_CONTAINER_NAME}`));
			
			if (containerExists)
			{
				const runningContainers = await this.docker.listContainers();
				const containerRunning = runningContainers.some((container) => container.Names.includes(`/${config.DOCKER_CONTAINER_NAME}`));
				
				if (!containerRunning)
				{
					if (configNode.backend === 'file' && configNode.walletPassphrase)
					{
						// Remove container
						await this.containerRemove();
						Logger.info('dVPN node container has been removed successfully.');
					}
					else
					{
						await this.startContainerWithoutPassphrase(config.DOCKER_CONTAINER_NAME);
						Logger.info('dVPN node container has been started successfully.');
						return true;
					}
				}
			}
			
			// Create options for the container
			const createOptions =
			{
				name: config.DOCKER_CONTAINER_NAME,
				HostConfig: {
					Binds: [
						`${config.CONFIG_DIR}:${config.CONTAINER_DATA_DIR}`,
						'/lib/modules:/lib/modules'
					],
					CapDrop: ['ALL'],
					CapAdd: ['NET_ADMIN', 'NET_BIND_SERVICE', 'NET_RAW', 'SYS_MODULE'],
					Sysctls: {
						'net.ipv4.ip_forward': '1',
						'net.ipv6.conf.all.disable_ipv6': '0',
						'net.ipv6.conf.all.forwarding': '1',
						'net.ipv6.conf.default.forwarding': '1'
					},
					PortBindings: {
						[`${configNode.node_port}/tcp`]: [{ HostPort: `${configNode.node_port}` }]
					}
				},
				ExposedPorts: {
					[`${configNode.node_port}/tcp`]: {},
				}
			};
			
			// Add port bindings for WireGuard or V2Ray
			if (configNode.vpn_type === 'wireguard')
			{
				createOptions.HostConfig.PortBindings[`${configNode.vpn_port}/udp`] = [{ HostPort: `${configNode.vpn_port}` }];
				createOptions.ExposedPorts[`${configNode.vpn_port}/udp`] = {};
			}
			else if (configNode.vpn_type === 'v2ray')
			{
				createOptions.HostConfig.PortBindings[`${configNode.vpn_port}/tcp`] = [{ HostPort: `${configNode.vpn_port}` }];
				createOptions.ExposedPorts[`${configNode.vpn_port}/tcp`] = {};
			}
			else if (configNode.vpn_type === 'openvpn')
			{
				const protocol = (configNode.vpn_protocol || 'udp').toLowerCase();
				createOptions.HostConfig.PortBindings[`${configNode.vpn_port}/${protocol}`] = [{ HostPort: `${configNode.vpn_port}` }];
				createOptions.ExposedPorts[`${configNode.vpn_port}/${protocol}`] = {};
			}
			else
			{
				Logger.error(`Invalid node type or missing port. Type: ${configNode.vpn_type}, Port: ${configNode.vpn_port}`);
				return false;
			}
			
			// Check if the container is running successfully
			let result = false;
			
			// Start the container with or without passphrase
			if (configNode.backend === 'file' && configNode.walletPassphrase)
			{
				result = await this.startContainerWithPassphrase(config.DOCKER_CONTAINER_NAME, configNode.walletPassphrase, createOptions);
			}
			else
			{
				await this.docker.createContainer({
					...createOptions,
					Image: config.DOCKER_CONTAINER_NAME,
					Cmd: ['start']
				});
				result = await this.startContainerWithoutPassphrase(config.DOCKER_CONTAINER_NAME);
			}
			
			return result;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to start the dVPN node container: ${err.message}`);
			else
				Logger.error(`Failed to start the dVPN node container: ${String(err)}`);
			
			return false;
		}
	}
	
	/**
	 * Start Docker container without passphrase
	 * @returns boolean
	 */
	private async startContainerWithoutPassphrase(containerName: string): Promise<boolean>
	{
		try
		{
			await this.docker.getContainer(containerName).start();
			Logger.info('dVPN node container has been started successfully.');
			return true;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to start the dVPN node container: ${err.message}`);
			else
				Logger.error(`Failed to start the dVPN node container: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Start Docker container with passphrase
	 * @param containerName string
	 * @param walletPassphrase string
	 * @param createOptions Docker.ContainerCreateOptions
	 * @returns boolean
	 */
	private async startContainerWithPassphrase(containerName: string, walletPassphrase: string, createOptions: Docker.ContainerCreateOptions): Promise<boolean>
	{
		try
		{
			// Options for the container
			const options = {
				name: containerName,
				Image: config.DOCKER_CONTAINER_NAME,
				Cmd: ['start'],
				abortSignal: undefined,
				AttachStdin: true,
				AttachStdout: true,
				AttachStderr: true,
				OpenStdin: true,
				StdinOnce: false,
				Tty: true,
				...createOptions,
			};
			
			// Create the container if needed
			let container: Docker.Container = await this.docker.createContainer(options);
			//
			const result = await new Promise<boolean>((resolve, reject) =>
			{
				container.attach({
					stream: true,
					hijack: true,
					stdin: true,
					stdout: true,
					stderr: true
				},
				function(err: any, stream: any)
				{
					// Handle the error
					if (err)
					{
						if (err instanceof Error)
						{
							Logger.error(`Error attaching to container: ${err.message}`);
							return reject(false);
						}
						else
						{
							Logger.error(`Error attaching to container: ${String(err)}`);
							return reject(false);
						}
					}
					
					// Handle the output stream
					stream.on('data', (data: Buffer) =>
					{
						// If the data contains an error keyword, stop the container
						if (isPassphraseError(data.toString()))
						{
							// Stop the container
							container.stop();
							// Log the error
							Logger.error(`Container command "start" failed: ${data.toString()}`);
							return reject(false);
						}
						else if (data.toString().includes('Querying the account'))
						{
							// Detach the stream
							stream.end();
							return resolve(false);
						}
					});
					
					// Write the passphrase to the container's stdin
					stream.write(`${walletPassphrase}`);
					stream.write('\n');
				});
				
				// Start the container
				container.start().then(() =>
				{
					Logger.info('dVPN node container has been started successfully.');
					resolve(true);
					return true;
				})
					.catch ((startErr) =>
					{
						Logger.error(`Failed to start the container: ${startErr.message}`);
						reject(false);
						return false;
					});
			});
			
			return result;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to start the dVPN node container: ${err.message}`);
			else
				Logger.error(`Failed to start the dVPN node container: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Stop Docker container
	 * @returns boolean
	 */
	public async containerStop(): Promise<boolean>
	{
		// Check if container is running
		const isRunning = await containerRunning();
		if (!isRunning)
		{
			Logger.info('dVPN node container is already stopped.');
			return true;
		}
		
		try
		{
			await this.docker.getContainer(config.DOCKER_CONTAINER_NAME).stop();
			Logger.info('dVPN node container has been stopped successfully.');
			return true;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to stop the dVPN node container: ${err.message}`);
			else
				Logger.error(`Failed to stop the dVPN node container: ${String(err)}`);
			
			return false;
		}
	}
	
	/**
	 * Restart Docker container
	 * @returns boolean
	 */
	public async containerRestart(): Promise<boolean>
	{
		try
		{
			const isRunning = await containerRunning();
			if (isRunning)
			{
				const stopSuccess = await containerStop();
				if (!stopSuccess)
					return false;
			}
			
			const startSuccess = await containerStart();
			if (!startSuccess)
				return false;
			
			Logger.info('dVPN node container has been restarted successfully.');
			return true;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to restart the dVPN node container: ${err.message}`);
			else
				Logger.error(`Failed to restart the dVPN node container: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Check if the container is running
	 * @returns boolean
	 */
	public async containerRunning(): Promise<boolean>
	{
		try
		{
			const runningContainers = await this.docker.listContainers();
			const isRunning = runningContainers.some((container) => container.Names.includes(`/${config.DOCKER_CONTAINER_NAME}`));
			return isRunning;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to check if the container is running: ${err.message}`);
			else
				Logger.error(`Failed to check if the container is running: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Check if the container exists
	 * @returns boolean
	 */
	public async containerExists(): Promise<boolean>
	{
		try
		{
			const containers = await this.docker.listContainers({ all: true });
			const containerExists = containers.some((container) => container.Names.includes(`/${config.DOCKER_CONTAINER_NAME}`));
			return containerExists;
		}
		catch (err)
		{
			Logger.error(`Error while checking if container ${config.DOCKER_CONTAINER_NAME} exists:\n${err?.toString()}`);
		}
		
		return false;
	}
	
	/**
	 * Remove Docker container
	 * @returns boolean
	 */
	public async containerRemove(): Promise<boolean>
	{
		try
		{
			// Check if the container exists
			const exists = await containerExists();
			if (!exists)
				return true;
			
			// Stop the container
			await containerStop();
			
			// Remove the container
			await this.docker.getContainer(config.DOCKER_CONTAINER_NAME).remove({ force: true });
			Logger.info('dVPN node container has been removed successfully.');
			return true;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to remove the dVPN node container: ${err.message}`);
			else
				Logger.error(`Failed to remove the dVPN node container: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Convert buffer to stream
	 * @param buffer
	 */
	private async bufferToStream(buffer: Buffer): Promise<Readable>
	{
		const readable = new Readable();
		readable.push(buffer);
		readable.push(null); // No more data
		return readable;
	}
	
	/**
	 * Convert stream to string
	 * @param stream Readable
	 * @returns string
	 */
	private async streamToString(stream: Readable): Promise<string>
	{
		const chunks: any[] = [];
		return new Promise((resolve, reject) =>
		{
			stream.on('data', (chunk) => chunks.push(chunk));
			stream.on('error', reject);
			stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
		});
	}
	
	/**
	 * Get container status
	 * @returns string
	 */
	public async containerStatus(): Promise<string>
	{
		// Check if the container exists
		const exists = await containerExists();
		if (exists)
		{
			const isRunning = await containerRunning();
			if (isRunning)
				return 'running';
			else
				return 'stopped';
		}
		
		return 'unavailable';
	}
	
	/**
	 * Get container logs
	 * @returns string | null
	 */
	public async containerLogs(): Promise<string | null>
	{
		try
		{
			// Get the container
			const container = this.docker.getContainer(config.DOCKER_CONTAINER_NAME);
			// Get the logs
			const logBuffer = await container.logs({
				stdout: true,
				stderr: true,
				tail: 100
			});
			
			// Convert buffer to stream
			const logStream = await this.bufferToStream(logBuffer);
			// Convert stream to string
			const logs = await this.streamToString(logStream as Readable);
			
			Logger.info('Docker logs retrieved successfully.');
			return logs;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to retrieve the dVPN node container logs: ${err.message}`);
			else
				Logger.error(`Failed to retrieve the dVPN node container logs: ${String(err)}`);
			
		}
		
		return null;
	}

	/**
	 * Execute a container command
	 * @param argv string[]
	 * @param stdin string[]|null
	 * @param attachStdin boolean
	 * @param tty boolean
	 * @returns string
	 */
	public async containerCommand(argv: string[], stdin: string[] | null = null, attachStdin: boolean = true, tty: boolean = true): Promise<string | null>
	{
		// Check if docker image is available
		if (!await checkImageAvailability())
		{
			Logger.error(`Container command '${argv.join(' ')}' failed: Image does not exist.`);
			return null;
		}
		
		const containerName = config.DOCKER_CONTAINER_NAME;
		const configDir = config.CONFIG_DIR;
		
		try
		{
			// Create options for the container
			const createOptions: Docker.ContainerCreateOptions =
			{
				HostConfig:
				{
					Binds: [`${configDir}:${config.CONTAINER_DATA_DIR}`],
					AutoRemove: true
				},
				AttachStdout: true,
				AttachStderr: true,
				AttachStdin: attachStdin,
				OpenStdin: true,
				StdinOnce: false,
				Tty: tty,
			};
			
			// Create a stream for the container
			const outputStream = new PassThrough();
			
			// Execute the command
			await this.docker.run(containerName, argv, outputStream, createOptions, async (err) =>
			{
				if (err instanceof Error)
					Logger.error(`Error executing container command '${argv.join(' ')}': ${err.message}`);
				else if (err)
					Logger.error(`Error executing container command '${argv.join(' ')}': ${String(err)}`);
				else
				{
					// Convert buffer to stream
					const output = await this.passThroughToString(outputStream);
					Logger.info(`Error executing container command '${argv.join(' ')}': ${output}`);
				}
			})
				// Attach to the container
				.on('container', function(container)
				{
					// Attach to the container to interact with it
					container.attach({
						stream: true,
						hijack: true,
						stdin: true,
						stdout: true,
						stderr: true
					},
					function(err: any, stream: any)
					{
						if (err)
						{
							if (err instanceof Error)
								Logger.error(`Error attaching to container: ${err.message}`);
							else
								Logger.error(`Error attaching to container: ${String(err)}`);
							
							// Leave the function
							return;
						}
						
						// Handle the output stream
						stream.on('data', (data: Buffer) =>
						{
							// If the data contains an error keyword, stop the container
							if (isPassphraseError(data.toString()))
							{
								Logger.error(`Container command '${argv.join(' ')}' failed: ${data.toString()}`);
								// Stop the container
								container.stop();
							}
						});
						
						// If stdin data is provided, write it to the container's stdin
						if (stdin !== null)
						{
							stdin.forEach((line) =>
							{
								stream.write(line);
								stream.write('\n');
							});
						}
					});
				});
			
			// Convert buffer to stream
			const logs = await this.passThroughToString(outputStream);
			Logger.info(`Container command '${argv.join(' ')}' executed successfully.`);
			return logs;
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to execute container command '${argv.join(' ')}': ${err.message}`);
			else
				Logger.error(`Failed to execute container command '${argv.join(' ')}': ${String(err)}`);
			
		}
		return null;
	}
	
	/**
	 * Convert PassThrough stream to string
	 * @param passThroughStream PassThrough
	 * @returns string
	 */
	private async passThroughToString(passThroughStream: PassThrough): Promise<string>
	{
		const chunks: Buffer[] = [];
		return new Promise((resolve, reject) =>
		{
			passThroughStream.on('data', (chunk: Buffer) => chunks.push(chunk));
			passThroughStream.on('error', reject);
			passThroughStream.on('end', () =>
			{
				const buffer = Buffer.concat(chunks);
				let result = buffer.toString('utf-8');
				
				// Remove non-ASCII characters
				result = result.replace(/[^\x20-\x7E\n\r]/g, '');
				resolve(result);
			});
		});
	}
	
	/**
	 * Check if output is passphrase error
	 * @param output string
	 * @returns boolean
	 */
	public isPassphraseError(output: string): boolean
	{
		return DockerManager.passphraseErrors.some((keyword) => output.toLowerCase().includes(keyword));
	}
}

// Create a singleton instance of DockerManager
const dockerManager = DockerManager.getInstance();
export default dockerManager;

// Export utility functions
export const isPassphraseError = (output: string) => dockerManager.isPassphraseError(output);
export const checkImageAvailability = (): Promise<boolean> => dockerManager.checkImageAvailability();
export const inspectDockerContainer = (): Promise<Docker.ContainerInspectInfo | null> => dockerManager.inspectDockerContainer();
export const imagePull = (): Promise<boolean> => dockerManager.imagePull();
export const imagesRemove = (): Promise<boolean> => dockerManager.imagesRemove();
export const containerStart = (): Promise<boolean> => dockerManager.containerStart();
export const containerStop = (): Promise<boolean> => dockerManager.containerStop();
export const containerRestart = (): Promise<boolean> => dockerManager.containerRestart();
export const containerRunning = (): Promise<boolean> => dockerManager.containerRunning();
export const containerExists = (): Promise<boolean> => dockerManager.containerExists();
export const containerRemove = (): Promise<boolean> => dockerManager.containerRemove();
export const containerStatus = (): Promise<string> => dockerManager.containerStatus();
export const containerLogs = (): Promise<string | null> => dockerManager.containerLogs();
export const containerCommand = (argv: string[], stdin: string[] | null = null, attachStdin: boolean = true, tty: boolean = true): Promise<string | null> => dockerManager.containerCommand(argv, stdin, attachStdin, tty);
