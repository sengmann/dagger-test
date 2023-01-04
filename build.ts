import Client, { connect } from "@dagger.io/dagger"
import { OnePasswordConnect, ItemBuilder } from "@1password/connect";

const nginxConf = `
server {
  listen 80;
  sendfile on;
  default_type application/octet-stream;

  gzip on;
  gzip_http_version 1.1;
  gzip_disable      "MSIE [1-6]\.";
  gzip_min_length   256;
  gzip_vary         on;
  gzip_proxied      expired no-cache no-store private auth;
  gzip_types        text/plain text/css application/json application/javascript application/x-javascript text/xml application/xml application/xml+rss text/javascript;
  gzip_comp_level   9;

  root /usr/share/nginx/html;

  location / {
    try_files $uri $uri/ /index.html =404;
  }
}
`

// initialize Dagger client
await connect(async (client: Client) => {

  const onePasswordToken = await client.host().envVariable('ONE_PASSWORD_TOKEN').secret()
  
  const op = OnePasswordConnect({
    serverURL: "http://192.168.178.21:8080",
    token: await onePasswordToken.plaintext(),
    keepAlive: true,
  });
  
  const foo = await op.getItemById('ogfbxdkojzu42lrtig3xeezk6q' ,'ltvff2yrapkarbzqno6jfbqfsy')
  const pw = foo.fields?.find(field => field.id === 'password')?.value ?? ''

  const repoUrl = 'git@github.com:sengmann/dagger-ui-test.git'
  const sshAuthSockPath = process.env.SSH_AUTH_SOCK?.toString() ?? ""
  const sshAgentSocketID = await client.host().unixSocket(sshAuthSockPath).id()

  const repo = client
    // Retrieve the repository
    .git(repoUrl, { keepGitDir: true })
    // Select the main branch, and the filesystem tree associated
    .branch("main")
    .tree({
      sshAuthSocket: sshAgentSocketID,
    })

  const builder = client.container()
    .from('node:18')
    .withDirectory('/workdir', repo.directory('/'))
    .withWorkdir('/workdir')
    .withExec(['npm', 'ci'])
    .withExec(['npm', 'run', 'ng', '--', 'run', 'dagger-ui-test:build:production '])

  console.log(await builder.stdout())

  const runner = client.container()
    .from('nginx')
    .withNewFile('/etc/nginx/conf.d/default.conf', { contents: nginxConf })
    .withDirectory('/usr/share/nginx/html', builder.directory('/workdir/dist/apps/dagger-ui-test'))
    .withSecretVariable('ONE_PASSWORD_TOKEN', onePasswordToken)
    .withSecretVariable('FOO', pw)

  await runner.publish('sirion182/dagger-ui-test:latest')

}, { LogOutput: process.stdout })
