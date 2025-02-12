import { CloudConfig, getAndValidateAuthToken } from '../cli_config';
import { logMessage, PartialBy } from '../utils';
import path from 'path';
import compressing from 'compressing';
import * as fs from 'fs';
import { OperationsClient } from './operations';
import { SUBSCRIPTION_TYPE, SubscriptionClient } from './subscriptions';

// eslint-disable-next-line no-shadow
export enum ACCESS_TYPE {
  PUBLIC = 'public',
  UNLISTED = 'unlisted',
}

export interface UploadPageResponse {
  jobId: string;
  message: string;
  projectName: string;
  projectDomain: string;
}

export interface Page {
  id: string;
  /*
     since we do not want to expose who
     actually starred the project, instead we
     only expose number of stars
   */
  starredCount: number;
  // flag which is true if my account starred this project
  starredByMe: boolean;
  //
  ownedByMe: boolean;
  // full project url for the project index file in gcp bucket
  fullProjectUrl: string;
  // domain for the project, which will be used to proxy requests to gcp bucket location
  projectDomain: string;
  // project access type, public means, the project can be seen in the projects list by everyone, unlisted means, only people with hte link will have access
  accessType: ACCESS_TYPE;
  // email of the user who owns this project
  email: string;
  // the name of the project, unique
  projectName: string;
  // emails of people who starred the project
  starredBy: string[];
  apiNames: string[];
  apiPaths: string[];
}

/**
 * Either WLE_CREDENTIALS or WLE_CREDENTIALS_LOCATION should be set. If none are set,
 * the library tries to find a wle-apitoken.json in the current work directory
 */
export type PageConfig = PartialBy<
  Pick<
    CloudConfig,
    'WLE_CREDENTIALS' | 'COMMANDER_URL' | 'WLE_CREDENTIALS_LOCATION'
  >,
  'WLE_CREDENTIALS' | 'WLE_CREDENTIALS_LOCATION'
>;

/**
 * Helper class for interacting with the projects resouce.
 */
export class PageClient {
  config: PageConfig;
  authToken: string;
  operationsClient: OperationsClient;
  subscriptionClient: SubscriptionClient;

  // todo create dedicated projects config
  constructor(config: PageConfig) {
    this.config = config;
    this.authToken = getAndValidateAuthToken(this.config);
    this.operationsClient = new OperationsClient(config);
    this.subscriptionClient = new SubscriptionClient(config);
  }

  /**
   * Publishes a Wonderland Engine Project to the cloud, if a project
   * with the same name already exists, then the project is overwritten
   * else a new project is created.
   *
   * @param projectLocation {string} relative or absolute location of your deployment files
   * @param projectName {string} your project name
   * @param isPublic {boolean} whether your project is public or not
   * @param withThreads {boolean} use threads headers or not for better performance
   */
  async create(
    projectLocation: string,
    projectName: string,
    isPublic: boolean,
    withThreads: boolean
  ) {
    return this.#validateCreateOrUpdate(
      projectLocation,
      projectName,
      isPublic,
      true,
      withThreads
    );
  }

  /**
   * Updates an existing Wonderland engine project
   *
   * @param projectLocation {string} relative or absolute location of your deployment files
   * @param projectName {string} your project name
   * @param isPublic {boolean} whether your project is public or not
   * @param withThreads {boolean} use threads headers or not for better performance
   */
  async update(
    projectLocation: string,
    projectName: string,
    isPublic: boolean,
    withThreads: boolean
  ) {
    return this.#validateCreateOrUpdate(
      projectLocation,
      projectName,
      isPublic,
      false,
      withThreads
    );
  }

  /**
   * Get an existing Wonderland engine page
   *
   * @param pageName {string} your page project name
   */
  async get(pageName: string): Promise<Page> {
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/pages/${pageName}`,
      {
        method: 'GET',
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const serverData = await response.json();
    if (response.status < 400) {
      return serverData as Page;
    }
    logMessage('Failed to get page', pageName, response.status, serverData);
    throw Error('Failed to get project information');
  }

  /**
   * Delete a deployed page permanently. Warning, this operation is non-revertible and
   * cannot be recovered.
   * @param projectName {string}
   */
  async delete(projectName: string) {
    const pageNameValidated = this.#validatePageName(projectName);
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/pages/${pageNameValidated}`,
      {
        method: 'DELETE',
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const serverData = await response.json();
    if (response.status < 400) {
      logMessage('Successfully created delete project operation', serverData);
      await this.operationsClient.waitUntilJobHasFinished(serverData.jobId);
      return true;
    } else {
      logMessage('Failed to create delete project operation', serverData);
      throw Error('Failed to delete project files');
    }
  }

  /**
   * Lists your own project pages. You can also include the public resources available as well by
   * setting listPublic flag to true
   *
   * @param listPublic {boolean} whether to also list public pages or not
   */
  async list(listPublic = false): Promise<Page[]> {
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/pages?listPublic=${listPublic}`,
      {
        method: 'GET',
        headers: {
          authorization: this.authToken,
          'content-type': 'application/json',
        },
      }
    );
    const projects = await response.json();
    if (response.status < 400) {
      return projects;
    } else {
      logMessage('Failed to list projects', projects);
      throw Error('Failed to list project files');
    }
  }

  /**
   * Alter the Links between Apis and Pages, by adding/removing a
   * apiPath / apiName pair
   * @param existingPage
   */
  async modifyApis(existingPage: Page) {
    const subscriptions = await this.subscriptionClient.list();

    const validSubExists = subscriptions.find(
      (sub) => sub.type === SUBSCRIPTION_TYPE.PAGES_APIS
    );

    if (!validSubExists) {
      throw new Error(
        'could not find a valid subscription for creating a new server'
      );
    }
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/pages/apis`,
      {
        method: 'PUT',
        body: JSON.stringify({
          ...existingPage,
          subscriptionId: validSubExists.id,
        }),
        headers: {
          authorization: this.authToken,
          'content-type': 'application/json',
        },
      }
    );
    const modifyOperation = await response.json();
    if (response.status < 400) {
      await this.operationsClient.waitUntilJobHasFinished(
        modifyOperation.jobId
      );
      return this.get(existingPage.projectName);
    } else {
      logMessage(
        'Failed to modify page apis',
        response.status,
        modifyOperation
      );
      throw Error('Failed to list project files');
    }
  }

  async #validateCreateOrUpdate(
    projectLocation: string,
    projectName: string,
    isPublic: boolean,
    create: boolean,
    withThreads: boolean
  ) {
    const deploymentDirLocation = this.#validateDeploymentDir(projectLocation);
    const projectNameValidated = this.#validatePageName(projectName);
    const deploymentArchivePath = await this.#compressProjectFiles(
      deploymentDirLocation
    );
    const uploadProjectResponse = await this.#uploadProjectFiles(
      deploymentArchivePath,
      projectNameValidated,
      isPublic,
      create,
      withThreads
    );
    await this.#deleteDeploymentArchive(deploymentArchivePath);

    logMessage(
      `Creating new page deployment, pageUrl: ${uploadProjectResponse.projectDomain}`
    );
    await this.operationsClient.waitUntilJobHasFinished(
      uploadProjectResponse.jobId
    );

    return this.get(uploadProjectResponse.projectName);
  }

  #validatePageName(projectName: string) {
    const validName = /^[a-z](([a-z]|\d)-?([a-z]|\d)?){0,20}[a-z]/gm.test(
      projectName
    );
    if (validName) {
      return projectName;
    }
    logMessage(
      'invalid page name, max length is 22 chars and it can only contain' +
        ' lowercase letters and numbers connected with a single dash' +
        ' validation RegExp /^[a-z](([a-z]|\\d)-?([a-z]|\\d)?){0,20}[a-z]/gm'
    );
    throw new Error('page name validation failed!');
  }

  async #compressProjectFiles(deploymentDirLocation: string) {
    logMessage('Compressing files...');
    const sourceDir = path.join(deploymentDirLocation);
    const destinationFile = path.join(
      deploymentDirLocation,
      '..',
      'deploy.tar'
    );

    await compressing.tgz.compressDir(sourceDir, destinationFile);
    logMessage('Compressed files from', sourceDir, 'to', destinationFile);
    return destinationFile;
  }

  #validateDeploymentDir(location: string) {
    const localLocation = path.join(process.cwd(), location);
    const absoluteLocation = path.join(location);
    const localLocationExists = fs.existsSync(localLocation);
    const absoluteLocationExists = fs.existsSync(absoluteLocation);
    if (!localLocationExists && !absoluteLocationExists) {
      logMessage('Could not find provided location', location);
      throw new Error(`${location} not found!`);
    }
    const workLocation = localLocationExists ? localLocation : absoluteLocation;
    const dirContent = fs.readdirSync(workLocation);
    let binExists = false;
    let bundleExists = false;
    let indexHtmlExists = false;
    dirContent.forEach((entry) => {
      if (!binExists) {
        binExists =
          entry.endsWith('.bin') &&
          !entry.endsWith('-textures.bin') &&
          !entry.endsWith('-LoadingScreen.bin');
      }
      if (!bundleExists) {
        bundleExists = entry.endsWith('bundle.js');
      }
      if (!indexHtmlExists) {
        indexHtmlExists = entry.endsWith('index.html');
      }
    });
    if (!(binExists && bundleExists && indexHtmlExists)) {
      logMessage(
        `Could not file mandatory files in directory binExists:${binExists}` +
          ` bundleExists:${bundleExists} indexHtmlExists:${indexHtmlExists}`
      );
      throw new Error('Mandatory files missing, cannot proceed!');
    }
    return workLocation;
  }

  async #uploadProjectFiles(
    deploymentArchivePath: string,
    projectName: string,
    isPublic: boolean,
    create: boolean,
    withThreads = true
  ): Promise<UploadPageResponse> {
    logMessage(
      'Uploading page files... ',
      projectName,
      ' isPublic ',
      isPublic,
      ` with Threads ${withThreads}`
    );
    const formData = new FormData();
    const file = fs.readFileSync(deploymentArchivePath);

    formData.append('file', new Blob([file]), 'deploy.tar.gz');
    formData.append('projectName', projectName);
    formData.append('isPublic', `${isPublic}`);
    formData.append('withThreads', `${withThreads}`);
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/pages/file`,
      {
        method: create ? 'POST' : 'PUT',
        body: formData,
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const serverData = await response.json();
    if (response.status < 400) {
      logMessage(
        'Successfully uploaded pages files, waiting for operation to finish',
        serverData
      );
      return serverData;
    } else {
      logMessage('Failed to upload pages files', serverData);
      throw Error('Failed to upload pages files');
    }
  }

  async #deleteDeploymentArchive(deploymentArchivePath: string) {
    logMessage('Removing deployment archive...');
    await fs.rmSync(deploymentArchivePath, { recursive: true });
    logMessage('Removed deployment archive');
  }
}
