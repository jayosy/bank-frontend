pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    tools {
        nodejs 'nodejs-24'
    }

    environment {
        FRONT_INTERNAL_URL = 'http://bank-front:8080'
        SONARQUBE_INSTALLATION = 'sonarqube'
        SONAR_SCANNER_TOOL = 'sonar-scanner'

        IMAGE_REPOSITORY = 'bank-front'
    }

    stages {
       stage('Checkout') {
            steps {
                script {
                    def scmVariables = checkout scm

                    env.GIT_COMMIT_SHA =
                        scmVariables['GIT_COMMIT'] ?: sh(
                            script: 'git rev-parse HEAD',
                            returnStdout: true
                        ).trim()

                    echo "Commit récupéré : ${env.GIT_COMMIT_SHA}"
                }
            }
        }

        stage('Preflight') {
            steps {
                sh '''
                    set -eu

                    echo "=== Node.js ==="
                    node --version

                    echo
                    echo "=== npm ==="
                    npm --version

                    echo
                    echo "=== Version Node attendue ==="
                    cat .nvmrc

                    ACTIVE_NODE="$(node --version | sed 's/^v//')"
                    EXPECTED_NODE="$(cat .nvmrc)"

                    if [ "$ACTIVE_NODE" != "$EXPECTED_NODE" ]; then
                        echo "Version Node incorrecte."
                        echo "Attendue : $EXPECTED_NODE"
                        echo "Active   : $ACTIVE_NODE"
                        exit 1
                    fi

                    echo
                    echo "=== Docker ==="
                    docker version \
                      --format 'Docker Server: {{.Server.Version}}'

                    echo
                    echo "=== Docker Compose ==="
                    docker compose version

                    echo
                    echo "=== curl ==="
                    command -v curl

                    echo
                    echo "=== Réseau Docker ==="
                    docker network inspect bank-net >/dev/null
                    echo "bank-net disponible"

                    echo
                    echo "=== Configuration Compose ==="
                    docker compose config >/dev/null
                    echo "compose.yaml valide"

                    echo
                    echo "=== Backend depuis Jenkins ==="
                    curl -fsS \
                      http://bank-api:8080/api/health
                '''
            }
        }

        stage('Version metadata') {
            steps {
                script {
                    env.APP_VERSION = sh(
                        script: '''
                            node -p "require('./package.json').version"
                        ''',
                        returnStdout: true
                    ).trim()

                    sh '''
                        set -eu

                        node <<'NODE'
                        const pkg = require('./package.json');
                        const lock = require('./package-lock.json');

                        const version = pkg.version;
                        const lockRootVersion =
                        lock.packages?.['']?.version ?? lock.version;

                        const semverPattern =
                        /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$/;

                        if (!semverPattern.test(version)) {
                        throw new Error(
                            `Version SemVer invalide : ${version}`
                        );
                        }

                        if (version.includes('+')) {
                        throw new Error(
                            'Les métadonnées SemVer avec + ne sont pas utilisées ' +
                            'dans les tags Docker de ce projet.'
                        );
                        }

                        if (lock.version !== version) {
                        throw new Error(
                            `package-lock version ${lock.version} != ${version}`
                        );
                        }

                        if (lockRootVersion !== version) {
                        throw new Error(
                            `package-lock root ${lockRootVersion} != ${version}`
                        );
                        }

                        console.log(`Version validée : ${version}`);
                        NODE
                    '''

                    env.GIT_SHORT_SHA = sh(
                        script: 'git rev-parse --short=12 HEAD',
                        returnStdout: true
                    ).trim()

                    env.BUILD_DATE = sh(
                        script: "date -u +'%Y-%m-%dT%H:%M:%SZ'",
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG =
                        "${env.APP_VERSION}" +
                        "-b${env.BUILD_NUMBER}" +
                        "-${env.GIT_SHORT_SHA}"

                    env.IMAGE_REF =
                        "${env.IMAGE_REPOSITORY}:${env.IMAGE_TAG}"

                    env.RELEASE_GIT_TAG = sh(
                        script: """
                            git tag \
                            --points-at HEAD \
                            --list 'v${env.APP_VERSION}'
                        """,
                        returnStdout: true
                    ).trim()

                    env.RELEASE_IMAGE_REF =
                        env.RELEASE_GIT_TAG
                            ? "${env.IMAGE_REPOSITORY}:${env.APP_VERSION}"
                            : ''

                    currentBuild.displayName =
                        "#${env.BUILD_NUMBER} ${env.IMAGE_TAG}"
                }

                sh '''
                    set -eu

                    cat > build-metadata.properties <<EOF
        application=bank-front
        version=$APP_VERSION
        gitCommit=$GIT_COMMIT_SHA
        gitShortSha=$GIT_SHORT_SHA
        gitTag=${RELEASE_GIT_TAG:-}
        buildNumber=$BUILD_NUMBER
        buildDate=$BUILD_DATE
        image=$IMAGE_REF
        releaseImage=${RELEASE_IMAGE_REF:-}
        EOF

                    echo "=== Métadonnées du build ==="
                    cat build-metadata.properties
                '''
            }
        }

        stage('Install dependencies') {
            steps {
                sh '''
                    set -eu

                    npm ci
                '''
            }
        }

        stage('Lint') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Nettoyage des artefacts précédents ==="

                        rm -rf \
                        coverage \
                        coverage-publish \
                        dist \
                        .angular/cache

                        echo

                        echo "=== Analyse ESLint ==="

                        npm run lint:ci

                        echo
                        echo "ESLint validé"
                    '''
                }
            }
        }

       stage('Unit tests and coverage') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Tests unitaires et couverture ==="

                        rm -rf \
                        coverage \
                        coverage-publish

                        npm run test:coverage

                        echo
                        echo "=== Fichiers de couverture générés ==="

                        find coverage \
                        -maxdepth 4 \
                        -type f \
                        | sort

                        echo
                        echo "=== Recherche des rapports ==="

                        HTML_INDEX="$(
                            find coverage \
                            -maxdepth 2 \
                            -type f \
                            -name index.html \
                            -print \
                            -quit
                        )"

                        LCOV_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name lcov.info \
                            -print \
                            -quit
                        )"

                        JSON_SUMMARY="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name coverage-summary.json \
                            -print \
                            -quit
                        )"

                        COBERTURA_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name '*cobertura*.xml' \
                            -print \
                            -quit
                        )"

                        if [ -z "$HTML_INDEX" ]; then
                            echo "Rapport HTML de couverture introuvable."
                            exit 1
                        fi

                        if [ -z "$LCOV_FILE" ]; then
                            echo "Rapport LCOV introuvable."
                            exit 1
                        fi

                        if [ -z "$JSON_SUMMARY" ]; then
                            echo "Résumé JSON de couverture introuvable."
                            exit 1
                        fi

                        echo "HTML      : $HTML_INDEX"
                        echo "LCOV      : $LCOV_FILE"
                        echo "JSON      : $JSON_SUMMARY"
                        echo "Cobertura : ${COBERTURA_FILE:-non généré}"

                        echo
                        echo "=== Normalisation pour Jenkins ==="

                        REPORT_DIRECTORY="$(dirname "$HTML_INDEX")"

                        mkdir -p coverage-publish

                        cp -R \
                        "$REPORT_DIRECTORY/." \
                        coverage-publish/

                        cp \
                        "$LCOV_FILE" \
                        coverage-publish/lcov.info

                        cp \
                        "$JSON_SUMMARY" \
                        coverage-publish/coverage-summary.json

                        if [ -n "$COBERTURA_FILE" ]; then
                            cp \
                            "$COBERTURA_FILE" \
                            coverage-publish/cobertura-coverage.xml
                        fi

                        test -f coverage-publish/index.html
                        test -f coverage-publish/lcov.info
                        test -f coverage-publish/coverage-summary.json

                        echo
                        echo "Rapports de couverture validés"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: '''
                            coverage/**/*,
                            coverage-publish/**/*
                        ''',
                        allowEmptyArchive: true,
                        fingerprint: false
                    )

                    publishHTML(
                        target: [
                            reportDir: 'coverage-publish',
                            reportFiles: 'index.html',
                            reportName: 'Couverture Angular',
                            reportTitles: 'Rapport de couverture',
                            keepAll: true,
                            alwaysLinkToLastBuild: true,
                            allowMissing: true
                        ]
                    )
                }
            }
        }

        stage('SonarQube analysis') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    script {
                        def scannerHome = tool env.SONAR_SCANNER_TOOL

                        withEnv([
                            "SONAR_SCANNER_HOME=${scannerHome}"
                        ]) {
                            withSonarQubeEnv(
                                installationName: env.SONARQUBE_INSTALLATION,
                                credentialsId: 'sonarqube-bank-front-token'
                            ) {
                                sh '''
                                    set -eu

                                    echo "=== Préparation SonarQube ==="

                                    rm -rf .scannerwork

                                    test -f sonar-project.properties
                                    test -f coverage/bank-front/lcov.info

                                    echo
                                    echo "Serveur SonarQube : $SONAR_HOST_URL"

                                    curl \
                                    -fsS \
                                    --connect-timeout 5 \
                                    --max-time 15 \
                                    "$SONAR_HOST_URL/api/system/status"

                                    echo
                                    echo
                                    echo "=== Version SonarScanner ==="

                                    "$SONAR_SCANNER_HOME/bin/sonar-scanner" \
                                    --version

                                    echo
                                    echo "=== Analyse SonarQube ==="

                                    "$SONAR_SCANNER_HOME/bin/sonar-scanner"

                                    test \
                                    -f .scannerwork/report-task.txt

                                    echo
                                    echo "Analyse SonarQube envoyée"
                                '''
                            }
                        }
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    script {
                        def qualityGate = waitForQualityGate(
                            abortPipeline: false,
                            webhookSecretId: 'sonarqube-webhook-secret'
                        )

                        echo "Quality Gate SonarQube : ${qualityGate.status}"

                        if (qualityGate.status != 'OK') {
                            error(
                                "Quality Gate SonarQube non validé : " +
                                qualityGate.status
                            )
                        }
                    }
                }
            }
        }

        stage('Build Angular') {
            steps {
                sh '''
                    set -eu

                    npm run build:prod

                    test \
                    -f dist/bank-front/browser/index.html

                    echo "=== Génération de version.json ==="

                    node <<'NODE'
                    const fs = require('node:fs');

                    const versionMetadata = {
                    application: 'bank-front',
                    version: process.env.APP_VERSION,
                    image: process.env.IMAGE_REF,
                    gitCommit: process.env.GIT_COMMIT_SHA,
                    gitShortSha: process.env.GIT_SHORT_SHA,
                    gitTag: process.env.RELEASE_GIT_TAG || null,
                    buildNumber: Number(process.env.BUILD_NUMBER),
                    buildDate: process.env.BUILD_DATE
                    };

                    const target =
                    'dist/bank-front/browser/version.json';

                    fs.writeFileSync(
                    target,
                    JSON.stringify(versionMetadata, null, 2) + '\\n',
                    'utf8'
                    );

                    console.log(`Fichier généré : ${target}`);
                    NODE

                    test \
                    -f dist/bank-front/browser/version.json

                    node -e "
                    JSON.parse(
                        require('node:fs').readFileSync(
                        'dist/bank-front/browser/version.json',
                        'utf8'
                        )
                    )
                    "

                    cat dist/bank-front/browser/version.json

                    echo
                    echo "Build Angular versionné et validé"
                '''
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    set -eu

                    echo "=== Image attendue ==="
                    echo "$IMAGE_REF"

                    echo
                    echo "=== Configuration Compose résolue ==="

                    docker compose config >/dev/null

                    RESOLVED_IMAGE="$(
                        docker compose config --images |
                        head -n 1
                    )"

                    echo "Image Compose : $RESOLVED_IMAGE"

                    if [ "$RESOLVED_IMAGE" != "$IMAGE_REF" ]; then
                        echo "Image Compose incorrecte."
                        echo "Attendue : $IMAGE_REF"
                        echo "Résolue  : $RESOLVED_IMAGE"
                        exit 1
                    fi

                    echo
                    echo "=== Construction de l’image versionnée ==="

                    docker compose build \
                    bank-front

                    docker image inspect \
                    "$IMAGE_REF" \
                    >/dev/null

                    echo
                    echo "=== Vérification des labels OCI ==="

                    IMAGE_VERSION="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' \
                        "$IMAGE_REF"
                    )"

                    IMAGE_REVISION="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
                        "$IMAGE_REF"
                    )"

                    IMAGE_CREATED="$(
                        docker image inspect \
                        --format '{{ index .Config.Labels "org.opencontainers.image.created" }}' \
                        "$IMAGE_REF"
                    )"

                    echo "Version  : $IMAGE_VERSION"
                    echo "Revision : $IMAGE_REVISION"
                    echo "Création : $IMAGE_CREATED"

                    test "$IMAGE_VERSION" = "$APP_VERSION"
                    test "$IMAGE_REVISION" = "$GIT_COMMIT_SHA"
                    test "$IMAGE_CREATED" = "$BUILD_DATE"

                    if [ -n "${RELEASE_GIT_TAG:-}" ]; then
                        echo
                        echo "=== Tag de release détecté ==="
                        echo "$RELEASE_GIT_TAG"

                        docker image tag \
                        "$IMAGE_REF" \
                        "$RELEASE_IMAGE_REF"

                        docker image inspect \
                        "$RELEASE_IMAGE_REF" \
                        >/dev/null

                        echo "Alias release créé : $RELEASE_IMAGE_REF"
                    else
                        echo
                        echo "Aucun tag Git de release sur ce commit."
                    fi

                    echo
                    echo "=== Déploiement ==="

                    docker compose up \
                    -d \
                    --no-build \
                    bank-front

                    docker compose ps \
                    bank-front

                    CONTAINER_ID="$(
                        docker compose ps \
                        -q \
                        bank-front
                    )"

                    test -n "$CONTAINER_ID"

                    RUNNING_IMAGE_ID="$(
                        docker inspect \
                        --format '{{.Image}}' \
                        "$CONTAINER_ID"
                    )"

                    EXPECTED_IMAGE_ID="$(
                        docker image inspect \
                        --format '{{.Id}}' \
                        "$IMAGE_REF"
                    )"

                    if [ "$RUNNING_IMAGE_ID" != "$EXPECTED_IMAGE_ID" ]; then
                        echo "Le conteneur n’utilise pas l’image attendue."
                        echo "Image active   : $RUNNING_IMAGE_ID"
                        echo "Image attendue : $EXPECTED_IMAGE_ID"
                        exit 1
                    fi

                    echo
                    echo "Image déployée : $IMAGE_REF"
                '''
            }
        }

        stage('Smoke tests') {
            steps {
                sh '''
                    set -eu

                    echo "Attente du démarrage de bank-front..."

                    attempt=1

                    while true
                    do
                        HTTP_CODE="$(
                            curl \
                            -sS \
                            --connect-timeout 3 \
                            --max-time 5 \
                            -o frontend-health.json \
                            -w '%{http_code}' \
                            "$FRONT_INTERNAL_URL/health" ||
                            true
                        )"

                        if [ "$HTTP_CODE" = "200" ]; then
                            break
                        fi

                        if [ "$attempt" -ge 12 ]; then
                            echo "bank-front ne répond pas après 60 secondes."
                            echo "Dernier code HTTP : $HTTP_CODE"

                            cat frontend-health.json 2>/dev/null || true
                            docker compose ps
                            docker compose logs --tail=100 bank-front

                            exit 1
                        fi

                        echo "Tentative $attempt/12 — HTTP $HTTP_CODE"

                        attempt=$((attempt + 1))
                        sleep 5
                    done

                    echo
                    echo "=== Health frontend ==="
                    cat frontend-health.json

                    grep -q '"status":"UP"' frontend-health.json
                    grep -q '"service":"bank-front"' frontend-health.json

                    echo
                    echo "=== Backend via Nginx ==="

                    BACKEND_HTTP_CODE="$(
                        curl \
                        -sS \
                        --connect-timeout 3 \
                        --max-time 10 \
                        -o backend-health.json \
                        -w '%{http_code}' \
                        "$FRONT_INTERNAL_URL/actuator/health" ||
                        true
                    )"

                    if [ "$BACKEND_HTTP_CODE" != "200" ]; then
                        echo "Healthcheck backend en échec."
                        echo "Code HTTP : $BACKEND_HTTP_CODE"

                        cat backend-health.json 2>/dev/null || true
                        exit 1
                    fi

                    cat backend-health.json

                    grep -q '"status":"UP"' backend-health.json

                    echo
                    echo "=== Page Angular ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/" |
                    grep -q '<bank-root'

                    echo "Composant bank-root détecté"
                    echo
                    echo "Déploiement frontend validé"

                    set -eu

                    echo "=== Version déployée ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/version.json" \
                    > deployed-version.json

                    cat deployed-version.json

                    node <<'NODE'
                    const fs = require('node:fs');

                    const deployed = JSON.parse(
                    fs.readFileSync(
                        'deployed-version.json',
                        'utf8'
                    )
                    );

                    const expected = {
                    application: 'bank-front',
                    version: process.env.APP_VERSION,
                    image: process.env.IMAGE_REF,
                    gitCommit: process.env.GIT_COMMIT_SHA,
                    gitShortSha: process.env.GIT_SHORT_SHA,
                    buildNumber: Number(process.env.BUILD_NUMBER),
                    buildDate: process.env.BUILD_DATE
                    };

                    for (const [key, expectedValue] of Object.entries(expected)) {
                    const actualValue = deployed[key];

                    if (actualValue !== expectedValue) {
                        throw new Error(
                        `${key}: attendu=${expectedValue}, obtenu=${actualValue}`
                        );
                    }
                    }

                    console.log(
                    `Version déployée validée : ${deployed.version}`
                    );

                    console.log(
                    `Image déployée validée : ${deployed.image}`
                    );
                    NODE
                '''
            }
        }
    }

    post {
        success {
            echo 'Pipeline frontend terminé avec succès.'
        }

        failure {
            echo 'Échec du pipeline frontend.'

            sh '''
                docker compose ps || true

                docker compose logs \
                --tail=150 \
                bank-front || true
            '''
        }

        always {
            archiveArtifacts(
                artifacts: '''
                    build-metadata.properties,
                    deployed-version.json
                ''',
                allowEmptyArchive: true,
                fingerprint: true
            )

            echo "Build Jenkins : ${env.BUILD_NUMBER}"
            echo "Version       : ${env.APP_VERSION ?: 'inconnue'}"
            echo "Image         : ${env.IMAGE_REF ?: 'inconnue'}"
            echo "Commit Git    : ${env.GIT_COMMIT_SHA ?: 'inconnu'}"
        }
    }
}
