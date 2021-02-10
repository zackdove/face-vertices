var vertices = [];
var width;
var height;

class Vertex{
	constructor(){
		this.x = random(0, window.innerWidth);
		this.y = random(0, window.innerHeight);
		this.radius = random(3,10);
	}
	draw(){
		noStroke();
		fill('rgba(255,255,255,1)');
		circle(this.x,this.y,this.radius);
	}
	update(){
		
	}
	drawEdgesWithinX(threshold){
		for (vertex of vertices){
			if (!(vertex === this)){
				var dist = Math.sqrt(Math.pow((vertex.x-this.x),2) + Math.pow((vertex.y-this.y),2));
				// console.log(dist);
				if (dist < threshold){
					stroke('rgba(255,255,255,0.5)');
					strokeWeight(1);
        			line(this.x,this.y,vertex.x,vertex.y);
				}
			}
		}
	}
	drawNearestXEdges(x){
		var nearest = [];
		var nearestValues = [];
		for (var i = 0; i<vertices.length; i++){
			if (! (vertices[i] === this)){
				var dist = Math.sqrt(Math.pow((vertices[i].x-this.x),2) + Math.pow((vertices[i].y-this.y),2));
				if (nearest.length < x){
					nearest.push(vertices[i]);
					nearestValues.push(dist);
				} else {
					for (var j = 0; j<x; j++){
						if (dist < nearestValues[j]){
							nearest.splice(j, 1, vertices[i]);
							nearestValues.splice(j, 1, dist);
							break;
						}
					}
				}
			}
		} 
		console.log(nearest);
		for (var i = 0; i<nearest.length; i++){
			stroke('rgba(255,255,255,0.5)');
			strokeWeight(1);
			line(this.x,this.y,nearest[i].x,nearest[i].y);
		}
	}
	drawEdges(){
		this.drawEdgesWithinX(200);
		// this.drawNearestXEdges(3);
	}
}


function setup(){
	width = window.innerWidth;
	height = window.innerHeight;
	createCanvas(width, height);
	for (var i=0; i<20; i++){
		vertices.push(new Vertex);
	}
}

function draw(){
	background('#0f0f0f');
	for (vertex of vertices){
		vertex.draw();
		vertex.update();
		vertex.drawEdges();
	}
}