/**
 * Dynamic shader modules for WebGL base renderer.
 * Provides geometry, projection, and shader management abstractions
 * that align with the WebGPU migration architecture.
 */

class BaseGeometry {
    getShaderCode() {
        throw new Error('getShaderCode() must be implemented by geometry subclasses');
    }
}

class HypercubeGeometry extends BaseGeometry {
    getShaderCode() {
        return `
            float calculateLattice(vec3 p) {
                float density = max(0.1, u_gridDensity * 0.6 * (1.0 + u_audioBass * 0.4));
                vec3 cell = fract(p * density * 0.5 + 0.5) - 0.5;
                float cellDistance = max(max(abs(cell.x), abs(cell.y)), abs(cell.z));
                float edges = 1.0 - smoothstep(0.0, max(0.0001, u_lineThickness), cellDistance);
                float dim_factor = smoothstep(3.0, 4.5, u_dimension);
                float lattice3D = pow(max(0.0, edges), max(0.1, u_universeModifier));

                if (dim_factor > 0.01) {
                    float w_coord = sin(p.x * 1.3 + p.y * 0.9 - p.z * 0.7 + u_time * 0.3)
                                   * dim_factor * (0.45 + u_morphFactor * 0.55 + u_audioMid * 0.45);
                    vec4 p4d = vec4(p, w_coord);
                    float baseSpeed = max(0.01, u_rotationSpeed);
                    float time_rot1 = u_time * 0.32 * baseSpeed + u_audioHigh * 0.25;
                    float time_rot2 = u_time * -0.27 * baseSpeed + u_audioBass * 0.2;
                    float time_rot3 = u_time * 0.24 * baseSpeed + u_audioMid * 0.2;
                    p4d = rotXW(time_rot1) * rotZW(time_rot2) * rotYW(time_rot3) * p4d;
                    vec3 projectedP = project4Dto3D(p4d);
                    vec3 projectedCell = fract(projectedP * density * 0.5 + 0.5) - 0.5;
                    float projectedDistance = max(max(abs(projectedCell.x), abs(projectedCell.y)), abs(projectedCell.z));
                    float lattice4D = 1.0 - smoothstep(0.0, max(0.0001, u_lineThickness), projectedDistance);
                    lattice3D = mix(lattice3D, pow(max(0.0, lattice4D), max(0.1, u_universeModifier)), smoothstep(0.0, 1.0, u_morphFactor));
                }

                return lattice3D;
            }
        `;
    }
}

class HypersphereGeometry extends BaseGeometry {
    getShaderCode() {
        return `
            float calculateLattice(vec3 p) {
                float radius3D = length(p);
                float densityFactor = max(0.1, u_gridDensity * 0.7 * (1.0 + u_audioBass * 0.5));
                float dynamicShellWidth = max(0.005, u_shellWidth * (1.0 + u_audioMid * 1.5));
                float phase = radius3D * densityFactor * 6.28318 - u_time * u_rotationSpeed * 0.8 + u_audioHigh * 3.0;
                float shells3D = 0.5 + 0.5 * sin(phase);
                shells3D = smoothstep(1.0 - dynamicShellWidth, 1.0, shells3D);

                float finalLattice = shells3D;
                float dim_factor = smoothstep(3.0, 4.5, u_dimension);

                if (dim_factor > 0.01) {
                    float w_coord = cos(radius3D * 2.5 - u_time * 0.55)
                                  * sin(p.x * 1.0 + p.y * 1.3 - p.z * 0.7 + u_time * 0.2)
                                  * dim_factor * (0.5 + u_morphFactor * 0.5 + u_audioMid * 0.5);

                    vec4 p4d = vec4(p, w_coord);
                    float baseSpeed = u_rotationSpeed * 0.85;
                    float time_rot1 = u_time * 0.38 * baseSpeed + u_audioHigh * 0.2;
                    float time_rot2 = u_time * 0.31 * baseSpeed + u_morphFactor * 0.6;
                    float time_rot3 = u_time * -0.24 * baseSpeed + u_audioBass * 0.25;
                    p4d = rotXW(time_rot1 * 1.05) * rotYZ(time_rot2) * rotYW(time_rot3 * 0.95) * p4d;

                    vec3 projectedP = project4Dto3D(p4d);
                    float radius4D_proj = length(projectedP);
                    float phase4D = radius4D_proj * densityFactor * 6.28318 - u_time * u_rotationSpeed * 0.8 + u_audioHigh * 3.0;
                    float shells4D_proj = 0.5 + 0.5 * sin(phase4D);
                    shells4D_proj = smoothstep(1.0 - dynamicShellWidth, 1.0, shells4D_proj);
                    finalLattice = mix(shells3D, shells4D_proj, smoothstep(0.0, 1.0, u_morphFactor));
                }
                return pow(max(0.0, finalLattice), max(0.1, u_universeModifier));
            }
        `;
    }
}

class HypertetrahedronGeometry extends BaseGeometry {
    getShaderCode() {
        return `
            float calculateLattice(vec3 p) {
                float density = max(0.1, u_gridDensity * 0.65 * (1.0 + u_audioBass * 0.4));
                float dynamicThickness = max(0.003, u_tetraThickness * (1.0 - u_audioMid * 0.7));

                vec3 c1 = normalize(vec3(1.0, 1.0, 1.0));
                vec3 c2 = normalize(vec3(-1.0, -1.0, 1.0));
                vec3 c3 = normalize(vec3(-1.0, 1.0, -1.0));
                vec3 c4 = normalize(vec3(1.0, -1.0, -1.0));
                vec3 p_mod3D = fract(p * density * 0.5 + 0.5 + u_time * 0.005) - 0.5;
                float d1 = dot(p_mod3D, c1);
                float d2 = dot(p_mod3D, c2);
                float d3 = dot(p_mod3D, c3);
                float d4 = dot(p_mod3D, c4);
                float minDistToPlane3D = min(min(abs(d1), abs(d2)), min(abs(d3), abs(d4)));
                float lattice3D = 1.0 - smoothstep(0.0, dynamicThickness, minDistToPlane3D);

                float finalLattice = lattice3D;
                float dim_factor = smoothstep(3.0, 4.5, u_dimension);

                if (dim_factor > 0.01) {
                    float w_coord = cos(p.x * 1.8 - p.y * 1.5 + p.z * 1.2 + u_time * 0.24)
                                   * sin(length(p) * 1.4 + u_time * 0.18 - u_audioMid * 2.0)
                                   * dim_factor * (0.45 + u_morphFactor * 0.55 + u_audioHigh * 0.4);
                    vec4 p4d = vec4(p, w_coord);
                    float baseSpeed = u_rotationSpeed * 1.15;
                    float time_rot1 = u_time * 0.28 * baseSpeed + u_audioHigh * 0.25;
                    float time_rot2 = u_time * 0.36 * baseSpeed - u_audioBass * 0.2 + u_morphFactor * 0.4;
                    float time_rot3 = u_time * 0.32 * baseSpeed + u_audioMid * 0.15;
                    p4d = rotXW(time_rot1 * 0.95) * rotYW(time_rot2 * 1.05) * rotZW(time_rot3) * p4d;
                    vec3 projectedP = project4Dto3D(p4d);

                    vec3 p_mod4D_proj = fract(projectedP * density * 0.5 + 0.5 + u_time * 0.008) - 0.5;
                    float dp1 = dot(p_mod4D_proj, c1);
                    float dp2 = dot(p_mod4D_proj, c2);
                    float dp3 = dot(p_mod4D_proj, c3);
                    float dp4 = dot(p_mod4D_proj, c4);
                    float minDistToPlane4D = min(min(abs(dp1), abs(dp2)), min(abs(dp3), abs(dp4)));
                    float lattice4D_proj = 1.0 - smoothstep(0.0, dynamicThickness, minDistToPlane4D);
                    finalLattice = mix(lattice3D, lattice4D_proj, smoothstep(0.0, 1.0, u_morphFactor));
                }
                return pow(max(0.0, finalLattice), max(0.1, u_universeModifier));
            }
        `;
    }
}

class BaseProjection {
    getShaderCode() {
        throw new Error('getShaderCode() must be implemented by projection subclasses');
    }
}

class PerspectiveProjection extends BaseProjection {
    getShaderCode() {
        return `
            vec3 project4Dto3D(vec4 p) {
                float baseDistance = 2.50;
                float dynamicDistance = max(0.2, baseDistance * (1.0 + u_morphFactor * 0.4 - u_audioMid * 0.35));
                float denominator = dynamicDistance + p.w;
                float w_factor = dynamicDistance / max(0.1, denominator);
                return p.xyz * w_factor;
            }
        `;
    }
}

class OrthographicProjection extends BaseProjection {
    getShaderCode() {
        return `
            vec3 project4Dto3D(vec4 p) {
                vec3 orthoP = p.xyz;
                float basePerspectiveDistance = 2.5;
                float dynamicPerspectiveDistance = max(0.2, basePerspectiveDistance * (1.0 - u_audioMid * 0.4));
                float perspDenominator = dynamicPerspectiveDistance + p.w;
                float persp_w_factor = dynamicPerspectiveDistance / max(0.1, perspDenominator);
                vec3 perspP = p.xyz * persp_w_factor;
                float morphT = smoothstep(0.0, 1.0, u_morphFactor);
                return mix(orthoP, perspP, morphT);
            }
        `;
    }
}

class StereographicProjection extends BaseProjection {
    getShaderCode() {
        return `
            vec3 project4Dto3D(vec4 p) {
                float basePoleW = -1.50;
                float dynamicPoleW = sign(basePoleW) * max(0.1, abs(basePoleW + u_audioHigh * 0.4 * sign(basePoleW)));
                float denominator = p.w - dynamicPoleW;
                vec3 projectedP;
                float epsilon = 0.001;
                if (abs(denominator) < epsilon) {
                    projectedP = normalize(p.xyz + vec3(epsilon)) * 1000.0;
                } else {
                    float scale = (-dynamicPoleW) / denominator;
                    projectedP = p.xyz * scale;
                }
                float morphT = smoothstep(0.0, 1.0, u_morphFactor * 0.8);
                vec3 orthoP = p.xyz;
                return mix(projectedP, orthoP, morphT);
            }
        `;
    }
}

class GeometryManager {
    constructor() {
        this.geometries = {
            hypercube: new HypercubeGeometry(),
            hypersphere: new HypersphereGeometry(),
            hypertetrahedron: new HypertetrahedronGeometry(),
        };
    }

    getGeometry(name) {
        return this.geometries[name] || this.geometries.hypercube;
    }
}

class ProjectionManager {
    constructor() {
        this.projections = {
            perspective: new PerspectiveProjection(),
            orthographic: new OrthographicProjection(),
            stereographic: new StereographicProjection(),
        };
    }

    getProjection(name) {
        return this.projections[name] || this.projections.perspective;
    }
}

class ShaderManager {
    constructor(gl, geometryManager, projectionManager) {
        this.gl = gl;
        this.geometryManager = geometryManager;
        this.projectionManager = projectionManager;
        this.programs = {};
        this.uniformLocations = {};
        this.attributeLocations = {};
        this.programMeta = {};
        this.currentProgramName = null;
    }

    createDynamicProgram(programName, geometryType, projectionMethod) {
        const vertexShaderSource = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const geometry = this.geometryManager.getGeometry(geometryType);
        const projection = this.projectionManager.getProjection(projectionMethod);

        const fragmentShaderSource = `
            precision highp float;
            uniform vec2 u_resolution; uniform float u_time;
            uniform float u_dimension; uniform float u_morphFactor; uniform float u_rotationSpeed;
            uniform float u_universeModifier; uniform float u_patternIntensity; uniform float u_gridDensity;
            uniform float u_lineThickness; uniform float u_shellWidth; uniform float u_tetraThickness;
            uniform float u_audioBass; uniform float u_audioMid; uniform float u_audioHigh;
            uniform float u_glitchIntensity; uniform float u_colorShift;
            uniform vec3 u_primaryColor; uniform vec3 u_secondaryColor; uniform vec3 u_backgroundColor;
            varying vec2 v_uv;

            mat4 rotXW(float a){float c=cos(a),s=sin(a);return mat4(c,0.0,0.0,-s,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,s,0.0,0.0,c);} 
            mat4 rotYW(float a){float c=cos(a),s=sin(a);return mat4(1.0,0.0,0.0,0.0,0.0,c,0.0,-s,0.0,0.0,1.0,0.0,0.0,s,0.0,c);} 
            mat4 rotZW(float a){float c=cos(a),s=sin(a);return mat4(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,c,-s,0.0,0.0,s,c);} 
            mat4 rotXY(float a){float c=cos(a),s=sin(a);return mat4(c,-s,0.0,0.0,s,c,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0);} 
            mat4 rotYZ(float a){float c=cos(a),s=sin(a);return mat4(1.0,0.0,0.0,0.0,0.0,c,-s,0.0,0.0,s,c,0.0,0.0,0.0,0.0,1.0);} 
            mat4 rotXZ(float a){float c=cos(a),s=sin(a);return mat4(c,0.0,-s,0.0,0.0,1.0,0.0,0.0,s,0.0,c,0.0,0.0,0.0,0.0,1.0);} 

            vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.0,-0.33333334,0.6666667,-1.0);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);float e=1e-10;return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x);} 
            vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,0.6666667,0.33333334,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);} 

            ${projection.getShaderCode()}
            ${geometry.getShaderCode()}

            void main() {
                vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
                vec2 uv = (v_uv * 2.0 - 1.0) * aspect;
                vec3 rayOrigin = vec3(0.0, 0.0, -2.5);
                vec3 rayDirection = normalize(vec3(uv, 1.0));
                float camRotY = u_time * 0.05 * u_rotationSpeed + u_audioMid * 0.1;
                float camRotX = sin(u_time * 0.03 * u_rotationSpeed) * 0.15 + u_audioHigh * 0.1;
                mat4 camMat = rotXY(camRotX) * rotYZ(camRotY);
                rayDirection = (camMat * vec4(rayDirection, 0.0)).xyz;
                vec3 p = rayDirection * 1.5;
                float latticeValue = calculateLattice(p);
                vec3 color = mix(u_backgroundColor, u_primaryColor, latticeValue);
                color = mix(color, u_secondaryColor, smoothstep(0.2, 0.7, u_audioMid) * latticeValue * 0.6);
                if (abs(u_colorShift) > 0.01) {
                    vec3 hsv = rgb2hsv(color);
                    hsv.x = fract(hsv.x + u_colorShift * 0.5 + u_audioHigh * 0.1);
                    color = hsv2rgb(hsv);
                }
                color *= (0.8 + u_patternIntensity * 0.7);
                if (u_glitchIntensity > 0.001) {
                    float glitch = u_glitchIntensity * (0.5 + 0.5 * sin(u_time * 8.0 + p.y * 10.0));
                    vec2 offsetR = vec2(cos(u_time * 25.0), sin(u_time * 18.0 + p.x * 5.0)) * glitch * 0.2 * aspect;
                    vec2 offsetB = vec2(sin(u_time * 19.0 + p.y * 6.0), cos(u_time * 28.0)) * glitch * 0.15 * aspect;
                    vec3 pR = normalize(vec3(uv + offsetR / aspect, 1.0));
                    pR = (camMat * vec4(pR, 0.0)).xyz * 1.5;
                    vec3 pB = normalize(vec3(uv + offsetB / aspect, 1.0));
                    pB = (camMat * vec4(pB, 0.0)).xyz * 1.5;
                    float latticeR = calculateLattice(pR);
                    float latticeB = calculateLattice(pB);
                    vec3 colorR = mix(u_backgroundColor, u_primaryColor, latticeR);
                    colorR = mix(colorR, u_secondaryColor, smoothstep(0.2, 0.7, u_audioMid) * latticeR * 0.6);
                    vec3 colorB = mix(u_backgroundColor, u_primaryColor, latticeB);
                    colorB = mix(colorB, u_secondaryColor, smoothstep(0.2, 0.7, u_audioMid) * latticeB * 0.6);
                    if (abs(u_colorShift) > 0.01) {
                        vec3 hsvR = rgb2hsv(colorR);
                        hsvR.x = fract(hsvR.x + u_colorShift * 0.5 + u_audioHigh * 0.1);
                        colorR = hsv2rgb(hsvR);
                        vec3 hsvB = rgb2hsv(colorB);
                        hsvB.x = fract(hsvB.x + u_colorShift * 0.5 + u_audioHigh * 0.1);
                        colorB = hsv2rgb(hsvB);
                    }
                    color = vec3(colorR.r, color.g, colorB.b);
                    color *= (0.8 + u_patternIntensity * 0.7);
                }
                color = pow(clamp(color, 0.0, 1.5), vec3(0.9));
                gl_FragColor = vec4(color, 1.0);
            }
        `;

        const vertexShader = this.compileShader(vertexShaderSource, this.gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER);

        if (!vertexShader || !fragmentShader) {
            return null;
        }

        if (this.programs[programName]) {
            this.gl.deleteProgram(this.programs[programName]);
            this.uniformLocations[programName] = {};
            this.attributeLocations[programName] = {};
        }

        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program link error:', this.gl.getProgramInfoLog(program));
            return null;
        }

        this.programs[programName] = program;
        this.uniformLocations[programName] = {};
        this.attributeLocations[programName] = {};
        this.programMeta[programName] = { geometryType, projectionMethod };
        return program;
    }

    compileShader(source, type) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    useProgram(programName) {
        const program = this.programs[programName];
        if (program) {
            this.gl.useProgram(program);
            this.currentProgramName = programName;
            return true;
        }
        return false;
    }

    getUniformLocation(name) {
        if (!this.currentProgramName) return null;
        const cache = this.uniformLocations[this.currentProgramName];
        if (cache[name] !== undefined) {
            return cache[name];
        }
        const location = this.gl.getUniformLocation(this.programs[this.currentProgramName], name);
        cache[name] = location;
        return location;
    }

    getAttributeLocation(name) {
        if (!this.currentProgramName) return null;
        const cache = this.attributeLocations[this.currentProgramName];
        if (cache[name] !== undefined) {
            return cache[name];
        }
        const location = this.gl.getAttribLocation(this.programs[this.currentProgramName], name);
        cache[name] = location;
        return location;
    }
}

export {
    BaseGeometry,
    HypercubeGeometry,
    HypersphereGeometry,
    HypertetrahedronGeometry,
    BaseProjection,
    PerspectiveProjection,
    OrthographicProjection,
    StereographicProjection,
    GeometryManager,
    ProjectionManager,
    ShaderManager,
};
