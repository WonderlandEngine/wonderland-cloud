import { CloudConfig, getAndValidateAuthToken } from '../cli_config';
import { logMessage, PartialBy } from '../utils';
import path from 'path';
import compressing from 'compressing';
import * as fs from 'fs';
import { OperationsClient } from './operations';

// eslint-disable-next-line no-shadow
export enum ACCESS_TYPE {
  PUBLIC = 'public',
  UNLISTED = 'unlisted',
}

export interface UploadPageResponse {
  jobId: string;
  message: string;
  projectName: string;
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
}

/**
 * Either AUTH_TOKEN or AUTH_TOKEN_LOCATION should be set. If none are set,
 * the library tries to find a wle-apitoken.json in the current work directory
 */
export type PageConfig = PartialBy<
  Pick<CloudConfig, 'AUTH_TOKEN' | 'COMMANDER_URL' | 'AUTH_TOKEN_LOCATION'>,
  'AUTH_TOKEN' | 'AUTH_TOKEN_LOCATION'
>;

/**
 * Helper class for interacting with the projects resouce.
 */
export class PageClient {
  config: PageConfig;
  authToken: string;
  operationsClient: OperationsClient;

  // todo create dedicated projects config
  constructor(config: PageConfig) {
    this.config = config;
    this.authToken = getAndValidateAuthToken(this.config);
    this.operationsClient = new OperationsClient(config);
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
  async get(pageName: string) {
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
      logMessage('Successfully loaded page', serverData);
      return serverData;
    }
    logMessage('failed to get page', pageName, serverData);
    throw Error('failed to get project information');
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
      logMessage('successfully created delete project operation', serverData);
      await this.operationsClient.waitUntilJobHasFinished(serverData.jobId);
      return true;
    } else {
      logMessage('failed to create delete project operation', serverData);
      throw Error('failed to delete project files');
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
      logMessage('failed to list projects', projects);
      throw Error('failed to list project files');
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
    logMessage('compressing files...');
    const sourceDir = path.join(deploymentDirLocation);
    const destinationFile = path.join(
      deploymentDirLocation,
      '..',
      'deploy.tar'
    );

    await compressing.tar.compressDir(sourceDir, destinationFile);
    logMessage('compressed files from', sourceDir, 'to', destinationFile);
    return destinationFile;
  }

  #validateDeploymentDir(location: string) {
    const localLocation = path.join(process.cwd(), location);
    const absoluteLocation = path.join(location);
    const localLocationExists = fs.existsSync(localLocation);
    const absoluteLocationExists = fs.existsSync(absoluteLocation);
    if (!localLocationExists && !absoluteLocationExists) {
      logMessage('could not find provided location', location);
      throw new Error(`${location} not found!`);
    }
    const workLocation = localLocationExists ? localLocation : absoluteLocation;
    const dirContent = fs.readdirSync(workLocation);
    if (!dirContent.includes('index.html')) {
      logMessage(
        'could not find index.html in deployment dir, cannot proceed with page upload'
      );
      throw new Error('index.html in deployment directory missing');
    }
    if (!dirContent.includes('index.html')) {
      logMessage(
        'could not find index.html in deployment dir, cannot proceed with project upload'
      );
      throw new Error('index.html in deployment directory missing');
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
      'uploading page files... ',
      projectName,
      ' isPublic ',
      isPublic
    );
    const formData = new FormData();
    const file = fs.readFileSync(deploymentArchivePath);

    formData.append('file', new Blob([file]), 'deploy.tar');
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
        'successfully uploaded pages files, waiting for operation to finish',
        serverData
      );
      return serverData;
    } else {
      logMessage('failed to upload pages files', serverData);
      throw Error('failed to upload pages files');
    }
  }

  async #deleteDeploymentArchive(deploymentArchivePath: string) {
    logMessage('removing deployment archive...');
    await fs.rmSync(deploymentArchivePath, { recursive: true });
    logMessage('removed deployment archive');
  }
}
