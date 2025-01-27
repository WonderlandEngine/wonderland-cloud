# Wonderland Cloud - Command Line Interface (CLI)

This package provides a CLI client and a node library for interacting with
Wonderland Cloud services.

## Usage

```
wl-cloud [resource] [command] ... [--help | -h]

The following resources are available:
- server
- page
- subscription
- api
...
```

### Examples

Here are some common examples on how to use the CLI tool:

#### Multi User Server Debugging

```sh
wl-cloud server debug <your-server-name>
```

This command will connect to your custom server via web sockets and
forward all `console.log` messages of your custom server to your local
console.

It also listens to file changes in your custom server code directory and
automatically packs, uploads, and restarts your server on change.

You can set the needed configuration values either via command line
argument or via environment variables.

To authenticate, place the downloaded token file from the
[Wonderland Engine Account page](https://wonderlandengine.com/account)
into your project folder and rename it to `wle-apitoken.json`.
Never commit this file to your version control, keep it local only.

The `wl-cloud` command will automatically find it and authenticate.

## Multi User Server Update

```
wl-cloud server update <your-server-name>
```

This command will pack and upload the local server project and deploy it
to your server at given server URL.

## Publish mode

This command allows you to publish your Wonderland Engine project as a static page deployment which will be hosted by
us. When you execute the command for the first time, a local `deployment.json` file will be created in your work
directory or by specifying the config location via the `--config=yourConfigPath`. If a config file is present, it will
always be used first and the command arguments for `project-name` and  `projectLocation` will be ignored. To explicitly
create a new project deployment instead of overwriting the existing deployment, provide a new `--config` path.

Once you have an existing config, you can also change the `access` or `withThreads` flag inside your config file and use
it to update you already existing project.

> [!NOTE]
> When creating a new project deployment, a page domain with new SSL certs is provisioned. As stated by Google, the SSL
> certs provisioning process can take up to 24h, so please be patient, if everything worked successfully, the custom
> domain
> usually works within max 30 minutes after creation.

### Available commands

* `create your-page-name ./path/to/deploy --access unlisted|public [--noThreads]` Creates a new page with the
  `your-page-name` name from `./path/to/deploy` with either public or unlisted access. Name and path are mandatory for
  creating. if you add the `--noThreads` flag, the additional response headers for enabling the WLE threads feature are
  omitted
* `update [your-page-name] ./path/to/deploy` Updates an existing page
* `list ` List all of your pages
* `delete your-page-name` Deletes your page
* `get your-page-name` Load remote page state and info

### Best use practices

It is recommended to use relative paths for the deployment location and the config locations. This way you can easily
share the projects pages configurations via collaborative software versioning tools such as git or SVC.

For example, you could have 2 project deployed, one public for production and one private for development preview. In
this example we expect, that a `wle-apitoken.json` file is present in the work directory. It is strongly advised to add
this file to your `.gitignore` file and inject it via environment variables in your CLI, a simple shell script for this
could look like this:

#### Encoding an existing wle-apitoken.json file to base64 and print to cmd

```shell
cat ./wle-apitoken.json | base64
```

#### Decoding your base64 encoded wle-apitoken.json file from CI env vars

```shell
echo $WLE_API_TOKEN_BASE64 | base64 -d > ./wle-apitoken.json
```

#### Initial project initialization for dev and prod

Production:

```shell
export PAGE_CONFIG_LOCATION=./projectConfigs/prod.json && export ACCESS=public && npm exec wl-cloud page create my-fancy-project ./deploy
```

Development

```shell
export PAGE_CONFIG_LOCATION=./projectConfigs/dev.json && export ACCESS=unlisted && npm exec wl-cloud page create my-fancy-project ./deploy
```

#### Scripts for publishing dev and prod in package.json

The visibility settings for the pages are set when initially creating the page and are retained on page updates.

```json
{
  "scripts": {
    "publish:prod": "wl-cloud page update --config ./projectConfigs/prod.json",
    "publish:dev": "wl-cloud page update --config ./projectConfigs/dev.json"
  }
}
```

#### Full CI script example using GitLab-CI and headless WonderlandEngine + wl-cloud cli

```yaml
deploy-production:
  image: wonderlandengine/editor:latest
  stage: deploy
  before-script:
    - echo $WLE_API_TOKEN_BASE64 | base64 -d > ./wle-apitoken.json
  script:
    - npm i
    - WonderlandEditor --windowless --credentials "$WLE_CREDENTIALS" --package --project ./MyFancyProject.wlp
    - npm run publish:prod
  cache:
    key: ${CI_COMMIT_REF_SLUG}
    paths:
      - cache/
  artifacts: [ ]
  rules:
    # only run pipeline on default branch changes
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: on_success
  # Avoid downloading artefacts
  needs: [ ]
```

### Available command line config arguments

* --config path (optional) specify the location of your config file for publishing
* --access public | unlisted (optional) allow listing your page in the public page explorer

### Example usage (first time usage)

Authentication is done either via `--authToken` argument option or via a `wle-apitoken.json` in your work directory.

#### Command line

```shell
npm exec wl-cloud page create my-fancy-project ./deploy
```

#### Command line with env args for auth token

```shell
export WLE_CREDENTIALS=YOUWLAPITOKEN && npm exec wl-cloud page create my-fancy-proejct ./deploy
```

#### package.json script

```json
{
  "scripts": {
    "page:new": "wl-cloud page create my-fancy-project ./deploy"
  }
}
```

This command will upload and publish the Wonderland Engine project page with the name `my-fancy-project` in the
relative `./deploy` directory. Once the project is published and deployed, a `deployment.json` with the
actual `projectName`, the absolute `projectLocation`, a flag if the project is public `isPublic`, the full project url
of the GCP bucket `fullProjectUrl` and your custom domain `projectDomain` will be created. If no `--access` type flag is
provided then project page will either use the value from the existing `deployment.json` or will default to `unlisted`,
meaning that the page cannot be found in the UI via the `page explorer`.

### Example usage (fist time usage deploy public project)

#### Command line

```shell
ACCESS=public && npm exec wl-cloud page create my-fancy-proejct ./deploy
```

#### package.json script

```json
{
  "scripts": {
    "project:new": "wl-cloud page create my-fancy-project ./deploy --access unlisted"
  }
}
```

### Example usage (fist time usage deploy public page and save config to dedicated location)

```shell
export ACCESS=public && export PAGE_CONFIG_LOCATION=./deployments/production.json && npm exec wl-cloud page create my-fancy-proejct ./deploy
```

### Example usage (change existing project (deployment.json in workDir) access type to unlisted)

```shell
export ACCESS=unlisted npm exec wl-cloud page update
```

### Example usage (change existing project (config json in provided config location) access type to public)

```shell
export ACCESS=public && export PAGE_CONFIG_LOCATION=./config/example-config.json &&  npm exec wl-cloud page update
```

## Deploying and working with apis

```shell
npm exec wl-cloud api create my-api-name 80 strm/helloworld-http env1=value1,env2=value2
```

This command will create a hello world application listening on port `80` with the image `strm/helloworld-http` and the environment values `env1=value1` and `env2=value2`.

### Updating single api properties

#### Updating env values

If you want to change or add env values to your current api deployment, you can do this via the command below.
Please note, that existing env vars will be overwritten.

```shell
npm exec wl-cloud api update my-api-name env env1=value1,env2=value2
```

If you want to remove all env vars and only add the provided ones, use example below

```shell
npm exec wl-cloud api update my-api-name env env1=value1,env2=value2 --updateEnv=false
```

#### Updating port value

If you want to change the port value, you can use the command below

```shell
npm exec wl-cloud api update my-api-name port 1234
```

#### Updating image value

If you want to change the used image, use the command below. This will trigger a new deployment. Please note,
that if the pod fails to start, a rollback to the previously working version is being performed.

```shell
npm exec wl-cloud api update my-api-name image my-image-registry.com/my-image-name:tagname
```

#### Updating dockerConfigBase64 value

If you want to change the docker secret for your private registry you can do this with the command below.

```shell
npm exec wl-cloud api update my-api-name dockerConfigBase64 my-image-registry.com/my-image-name:tagname
```

### Working with private registries

If you want to use a private docker registry, then you need to provide a docker login secret encoded in base64. You can
generate one by using this command.

```shell
kubectl create secret docker-registry --dry-run=true docker-regcred \
--docker-server=https://index.docker.io/v1/ \
--docker-username=xxx \
--docker-password=xxx \
--docker-email=yourmail@yourdomain.com \
-o yaml > docker-secret.yaml
```
This will generate a `.yaml` file with the following content

```yaml
apiVersion: v1
data:
  .dockerconfigjson: eyJhdXRocyI6eyJodHRwczovL2luZGV4LmRvY2tlci5pby92MS8iOnsidXNlcm5hbWUiOiJ4eHgiLCJwYXNzd29yZCI6Inh4eCIsImVtYWlsIjoieW91cm1haWxAeW91cmRvbWFpbi5jb20iLCJhdXRoIjoiZUhoNE9uaDRlQT09In19fQ==
kind: Secret
metadata:
  creationTimestamp: null
  name: docker-regcred
type: kubernetes.io/dockerconfigjson
```
Then you can copy the value for `.dockerconfigjson` and use it as the 4th argument when creating an api:

```shell
npm exec wl-cloud api create my-api-name 80 strm/helloworld-http eyJhdXRocyI6eyJodHRwczovL2luZGV4LmRvY2tlci5pby92MS8iOnsidXNlcm5hbWUiOiJ4eHgiLCJwYXNzd29yZCI6Inh4eCIsImVtYWlsIjoieW91cm1haWxAeW91cmRvbWFpbi5jb20iLCJhdXRoIjoiZUhoNE9uaDRlQT09In19fQ 
```

Creating an api with env vars and docker config

```shell
npm exec wl-cloud api create my-api-name 80 strm/helloworld-http env1=value1,env2=value2 eyJhdXRocyI6eyJodHRwczovL2luZGV4LmRvY2tlci5pby92MS8iOnsidXNlcm5hbWUiOiJ4eHgiLCJwYXNzd29yZCI6Inh4eCIsImVtYWlsIjoieW91cm1haWxAeW91cmRvbWFpbi5jb20iLCJhdXRoIjoiZUhoNE9uaDRlQT09In19fQ 
```

### Adding an api route to a page

If you want to add a new api route to a page deployment, you need to have the `Pages with Apis` subscription.
Then you can run this command to deploy your `my-api-name` at `my-api-path` on your `page-name`
```shell
npm exec wl-cloud page add-api page-name my-api-name my-path
```

This will publish your api on the `https://page-name.cloud.wondeland.dev/my-path` url

### Removing an api route from a page

To remove an api route from a page you can use this command.
```shell

wl-cloud page delete-api page-name my-api-name
```
## What is Wonderland Cloud?

[Wonderland Cloud](https://cloud.wonderland.dev) is a set of cloud services
specialized for 3D and XR web experiences, provided by [Wonderland](https://wonderlandengine.com).

The available services provided include multi-user servers optimized
for 3D and VR web apps, as well as free 3D web app hosting.

